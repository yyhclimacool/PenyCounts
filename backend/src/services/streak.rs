use std::collections::HashMap;

use chrono::{Duration, Local, NaiveDate};
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{Achievement, DayCount, StreakResponse};

/// Number of days of daily counts returned for the heatmap (~26 weeks).
const HEATMAP_DAYS: i64 = 182;

#[derive(sqlx::FromRow)]
struct DayRow {
    date: NaiveDate,
    cnt: i64,
}

pub async fn generate(pool: &PgPool, family_id: Uuid) -> Result<StreakResponse, AppError> {
    // Distinct active dates with per-day transaction counts (ascending).
    let rows = sqlx::query_as::<_, DayRow>(
        r#"
        SELECT date, COUNT(*) AS cnt
        FROM transactions
        WHERE family_id = $1
        GROUP BY date
        ORDER BY date ASC
        "#,
    )
    .bind(family_id)
    .fetch_all(pool)
    .await?;

    let total_active_days = rows.len() as i64;
    let total_transactions: i64 = rows.iter().map(|r| r.cnt).sum();

    let count_by_date: HashMap<NaiveDate, i64> =
        rows.iter().map(|r| (r.date, r.cnt)).collect();
    let active_dates: Vec<NaiveDate> = rows.iter().map(|r| r.date).collect();

    let today = Local::now().date_naive();
    let today_logged = count_by_date.contains_key(&today);

    // Longest streak across all history.
    let mut longest_streak: i64 = 0;
    let mut run: i64 = 0;
    let mut prev: Option<NaiveDate> = None;
    for &d in &active_dates {
        match prev {
            Some(p) if d == p + Duration::days(1) => run += 1,
            _ => run = 1,
        }
        if run > longest_streak {
            longest_streak = run;
        }
        prev = Some(d);
    }

    // Current streak: count back from today (or yesterday) while days are active.
    let mut current_streak: i64 = 0;
    let start = if today_logged {
        Some(today)
    } else if count_by_date.contains_key(&(today - Duration::days(1))) {
        Some(today - Duration::days(1))
    } else {
        None
    };
    if let Some(mut cursor) = start {
        while count_by_date.contains_key(&cursor) {
            current_streak += 1;
            cursor -= Duration::days(1);
        }
    }

    // Heatmap: dense daily counts for the recent window.
    let window_start = today - Duration::days(HEATMAP_DAYS - 1);
    let mut daily = Vec::with_capacity(HEATMAP_DAYS as usize);
    let mut cursor = window_start;
    while cursor <= today {
        daily.push(DayCount {
            date: cursor.format("%Y-%m-%d").to_string(),
            count: count_by_date.get(&cursor).copied().unwrap_or(0),
        });
        cursor += Duration::days(1);
    }

    let achievements = derive_achievements(
        total_active_days,
        total_transactions,
        current_streak,
        longest_streak,
    );

    Ok(StreakResponse {
        current_streak,
        longest_streak,
        total_active_days,
        total_transactions,
        today_logged,
        daily,
        achievements,
    })
}

fn ach(
    id: &str,
    title: &str,
    description: &str,
    icon: &str,
    value: i64,
    target: i64,
) -> Achievement {
    let progress = if target <= 0 {
        1.0
    } else {
        (value as f64 / target as f64).clamp(0.0, 1.0)
    };
    Achievement {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        icon: icon.to_string(),
        unlocked: value >= target,
        progress,
    }
}

/// Rule-based achievements derived purely from current stats — no extra storage.
fn derive_achievements(
    total_active_days: i64,
    total_transactions: i64,
    current_streak: i64,
    longest_streak: i64,
) -> Vec<Achievement> {
    let best_streak = longest_streak.max(current_streak);
    vec![
        ach(
            "first_step",
            "记账启程",
            "记录第一笔交易",
            "🌱",
            total_transactions,
            1,
        ),
        ach(
            "streak_3",
            "三日不辍",
            "连续记账 3 天",
            "🔥",
            best_streak,
            3,
        ),
        ach(
            "streak_7",
            "一周坚持",
            "连续记账 7 天",
            "⚡",
            best_streak,
            7,
        ),
        ach(
            "streak_30",
            "月度达人",
            "连续记账 30 天",
            "🏆",
            best_streak,
            30,
        ),
        ach(
            "days_50",
            "细水长流",
            "累计记账 50 天",
            "📅",
            total_active_days,
            50,
        ),
        ach(
            "tx_100",
            "百笔成就",
            "累计记录 100 笔交易",
            "💯",
            total_transactions,
            100,
        ),
        ach(
            "tx_500",
            "账本大师",
            "累计记录 500 笔交易",
            "👑",
            total_transactions,
            500,
        ),
    ]
}
