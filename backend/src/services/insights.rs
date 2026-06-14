use chrono::{Datelike, Local, NaiveDate};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{InsightCard, InsightOverview, InsightsResponse};
use crate::services::stats;

#[derive(sqlx::FromRow)]
struct PeriodSum {
    income: Decimal,
    expense: Decimal,
}

#[derive(sqlx::FromRow)]
struct CatMonthRow {
    category_name: String,
    icon: String,
    mo: i32,
    yr: i32,
    total: Decimal,
}

fn days_in_month(year: i32, month: u32) -> i32 {
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_next = NaiveDate::from_ymd_opt(ny, nm, 1).unwrap();
    let first_this = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    (first_next - first_this).num_days() as i32
}

async fn period_sum(
    pool: &PgPool,
    family_id: Uuid,
    year: i32,
    month: u32,
) -> Result<(Decimal, Decimal), AppError> {
    let row = sqlx::query_as::<_, PeriodSum>(
        "SELECT
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE family_id = $1
           AND EXTRACT(YEAR FROM date)::int4 = $2
           AND EXTRACT(MONTH FROM date)::int4 = $3",
    )
    .bind(family_id)
    .bind(year)
    .bind(month as i32)
    .fetch_one(pool)
    .await?;
    Ok((row.income, row.expense))
}

fn fmt_cny(d: Decimal) -> String {
    // Whole-yuan, thousands-separated for compact card copy.
    let v = d.round().to_i64().unwrap_or(0);
    let neg = v < 0;
    let mut s = v.abs().to_string();
    let mut out = String::new();
    while s.len() > 3 {
        let split = s.len() - 3;
        out = format!(",{}{}", &s[split..], out);
        s.truncate(split);
    }
    format!("{}¥{}{}", if neg { "-" } else { "" }, s, out)
}

/// Build the home-page insight payload entirely from SQL aggregates (no LLM):
/// fast, dependency-free, and already phrased in natural Chinese.
pub async fn generate(pool: &PgPool, family_id: Uuid) -> Result<InsightsResponse, AppError> {
    let today = Local::now().date_naive();
    let year = today.year();
    let month = today.month();
    let days_elapsed = today.day() as i32;
    let dim = days_in_month(year, month);

    // Current + previous month sums (previous handles year boundary).
    let (month_income, month_expense) = period_sum(pool, family_id, year, month).await?;
    let (prev_year, prev_month) = if month == 1 {
        (year - 1, 12u32)
    } else {
        (year, month - 1)
    };
    let (_li, last_month_expense) = period_sum(pool, family_id, prev_year, prev_month).await?;

    let month_net = month_income - month_expense;

    let expense_mom: Option<f64> = if last_month_expense.is_zero() {
        None
    } else {
        let cur = month_expense.to_f64().unwrap_or(0.0);
        let prev = last_month_expense.to_f64().unwrap_or(0.0);
        Some(((cur - prev) / prev * 1000.0).round() / 10.0)
    };

    let projected_expense = if days_elapsed > 0 {
        (month_expense * Decimal::from(dim) / Decimal::from(days_elapsed)).round_dp(2)
    } else {
        month_expense
    };

    // Top expense category this month.
    let cats = stats::category_breakdown(pool, family_id, year, Some(month), Some("expense")).await?;
    let top = cats.first();
    let top_category = top.map(|c| c.category_name.clone());
    let top_category_icon = top.map(|c| c.icon.clone());
    let top_category_amount = top.map(|c| c.total).unwrap_or_default();

    // Last transaction date -> gap in days.
    let last_date: Option<NaiveDate> =
        sqlx::query_scalar("SELECT MAX(date) FROM transactions WHERE family_id = $1")
            .bind(family_id)
            .fetch_one(pool)
            .await?;
    let days_since_last_txn = last_date.map(|d| (today - d).num_days() as i32);

    // Anomaly detection: per-category totals over the trailing 4 months.
    let start = {
        let (mut sy, mut sm) = (year, month as i32 - 3);
        while sm <= 0 {
            sm += 12;
            sy -= 1;
        }
        NaiveDate::from_ymd_opt(sy, sm as u32, 1).unwrap()
    };
    let end = {
        let (ny, nm) = if month == 12 {
            (year + 1, 1)
        } else {
            (year, month + 1)
        };
        NaiveDate::from_ymd_opt(ny, nm, 1).unwrap()
    };
    let cat_rows = sqlx::query_as::<_, CatMonthRow>(
        "SELECT c.name AS category_name, c.icon AS icon,
                EXTRACT(YEAR FROM t.date)::int4 AS yr,
                EXTRACT(MONTH FROM t.date)::int4 AS mo,
                COALESCE(SUM(t.amount), 0) AS total
         FROM transactions t
         JOIN categories c ON t.category_id = c.id
         WHERE t.family_id = $1 AND t.type = 'expense'
           AND t.date >= $2 AND t.date < $3
         GROUP BY c.name, c.icon, yr, mo",
    )
    .bind(family_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    // group by category: current-month total vs avg of prior months
    use std::collections::HashMap;
    let mut by_cat: HashMap<String, (String, f64, f64, i32)> = HashMap::new(); // name -> (icon, current, prior_sum, prior_count)
    for r in &cat_rows {
        let entry = by_cat
            .entry(r.category_name.clone())
            .or_insert((r.icon.clone(), 0.0, 0.0, 0));
        let total = r.total.to_f64().unwrap_or(0.0);
        if r.yr == year && r.mo == month as i32 {
            entry.1 += total;
        } else {
            entry.2 += total;
            entry.3 += 1;
        }
    }
    let mut anomalies: Vec<(String, String, f64, f64)> = Vec::new(); // (name, icon, current, ratio)
    for (name, (icon, current, prior_sum, prior_count)) in by_cat {
        if prior_count == 0 || current < 50.0 {
            continue;
        }
        let avg = prior_sum / prior_count as f64;
        if avg > 0.0 {
            let ratio = current / avg;
            if ratio >= 1.8 {
                anomalies.push((name, icon, current, ratio));
            }
        }
    }
    anomalies.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap_or(std::cmp::Ordering::Equal));

    // ── Build cards (ordered: alerts first) ─────────────────────────────
    let mut cards: Vec<InsightCard> = Vec::new();

    // Anomalies (top 2)
    for (name, icon, current, ratio) in anomalies.into_iter().take(2) {
        cards.push(InsightCard {
            id: format!("anomaly-{name}"),
            kind: "warning".into(),
            icon: "trending-up".into(),
            title: format!("{icon} {name} 支出偏高"),
            body: format!(
                "本月「{name}」已花 {}，约为近几月平均的 {:.1} 倍。",
                fmt_cny(Decimal::from_f64_retain(current).unwrap_or_default()),
                ratio
            ),
        });
    }

    // Net result
    if month_net < Decimal::ZERO {
        cards.push(InsightCard {
            id: "net-negative".into(),
            kind: "warning".into(),
            icon: "wallet".into(),
            title: "本月入不敷出".into(),
            body: format!("本月支出已超过收入 {}，注意控制开销。", fmt_cny(-month_net)),
        });
    } else if !month_income.is_zero() {
        cards.push(InsightCard {
            id: "net-positive".into(),
            kind: "success".into(),
            icon: "piggy-bank".into(),
            title: "本月有结余".into(),
            body: format!("本月结余 +{}，继续保持！", fmt_cny(month_net)),
        });
    }

    // Pace / projection
    if !month_expense.is_zero() && days_elapsed > 0 && days_elapsed < dim {
        cards.push(InsightCard {
            id: "pace".into(),
            kind: "info".into(),
            icon: "gauge".into(),
            title: "本月消费节奏".into(),
            body: format!(
                "本月已支出 {}，按当前节奏预计月底约 {}。",
                fmt_cny(month_expense),
                fmt_cny(projected_expense)
            ),
        });
    }

    // MoM
    if let Some(mom) = expense_mom {
        if mom.abs() >= 5.0 {
            let up = mom > 0.0;
            cards.push(InsightCard {
                id: "mom".into(),
                kind: if up { "warning".into() } else { "success".into() },
                icon: if up { "arrow-up-right".into() } else { "arrow-down-right".into() },
                title: format!("支出环比{}{:.1}%", if up { "上升 " } else { "下降 " }, mom.abs()),
                body: format!(
                    "相比上月（{}），本月支出{}。",
                    fmt_cny(last_month_expense),
                    if up { "有所增加" } else { "有所减少" }
                ),
            });
        }
    }

    // Top category
    if let (Some(name), icon) = (top_category.clone(), top_category_icon.clone()) {
        if !top_category_amount.is_zero() {
            let pct = top.map(|c| c.percentage).unwrap_or(0.0);
            cards.push(InsightCard {
                id: "top-category".into(),
                kind: "info".into(),
                icon: "pie-chart".into(),
                title: format!("{} 花钱最多", icon.unwrap_or_default()),
                body: format!(
                    "本月「{}」支出最高，{}，占总支出的 {:.0}%。",
                    name,
                    fmt_cny(top_category_amount),
                    pct
                ),
            });
        }
    }

    // Recording gap / streak nudge
    match days_since_last_txn {
        Some(0) => cards.push(InsightCard {
            id: "logged-today".into(),
            kind: "success".into(),
            icon: "check-circle".into(),
            title: "今天已记账".into(),
            body: "保持每日记账的好习惯，财务尽在掌握。".into(),
        }),
        Some(d) if d >= 3 => cards.push(InsightCard {
            id: "gap".into(),
            kind: "tip".into(),
            icon: "calendar-clock".into(),
            title: format!("已 {} 天没有记账", d),
            body: "别忘了把最近的开销记下来，避免遗漏。".into(),
        }),
        _ => {}
    }

    if cards.is_empty() {
        cards.push(InsightCard {
            id: "empty".into(),
            kind: "tip".into(),
            icon: "sparkles".into(),
            title: "开始记账吧".into(),
            body: "记录第一笔交易后，这里会出现专属于你的财务洞察。".into(),
        });
    }

    let overview = InsightOverview {
        year,
        month: month as i32,
        month_income,
        month_expense,
        month_net,
        last_month_expense,
        expense_mom,
        projected_expense,
        days_elapsed,
        days_in_month: dim,
        days_since_last_txn,
        top_category,
        top_category_icon,
        top_category_amount,
    };

    Ok(InsightsResponse { overview, cards })
}
