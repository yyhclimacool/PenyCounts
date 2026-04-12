-- Update subcategory icons with meaningful emojis
UPDATE subcategories SET icon = CASE name
    -- 餐饮美食
    WHEN '早餐' THEN '🥐'
    WHEN '午餐' THEN '🍱'
    WHEN '晚餐' THEN '🍲'
    WHEN '零食饮料' THEN '🧃'
    WHEN '外卖' THEN '🛵'
    WHEN '聚餐' THEN '🍻'
    -- 交通出行
    WHEN '公交地铁' THEN '🚇'
    WHEN '打车' THEN '🚕'
    WHEN '加油' THEN '⛽'
    WHEN '停车费' THEN '🅿️'
    WHEN '高速过路' THEN '🛣️'
    WHEN '车辆保养' THEN '🔧'
    -- 居家生活
    WHEN '水电燃气' THEN '💡'
    WHEN '物业费' THEN '🏢'
    WHEN '房租/房贷' THEN '🏡'
    WHEN '家居用品' THEN '🛋️'
    WHEN '维修保养' THEN '🪛'
    -- 购物消费
    WHEN '服饰鞋包' THEN '👗'
    WHEN '数码电子' THEN '📱'
    WHEN '日用百货' THEN '🧴'
    WHEN '化妆护肤' THEN '💄'
    WHEN '母婴用品' THEN '🍼'
    -- 医疗健康
    WHEN '门诊挂号' THEN '🩺'
    WHEN '药品' THEN '💊'
    WHEN '体检' THEN '🔬'
    WHEN '保健品' THEN '💪'
    -- 教育学习
    WHEN '培训课程' THEN '🎓'
    WHEN '书籍' THEN '📖'
    WHEN '学费' THEN '🏫'
    WHEN '文具' THEN '✏️'
    -- 休闲娱乐
    WHEN '电影演出' THEN '🎬'
    WHEN '旅游度假' THEN '✈️'
    WHEN '运动健身' THEN '🏋️'
    WHEN '游戏充值' THEN '🎮'
    -- 人情往来
    WHEN '红包礼金' THEN '🧧'
    WHEN '礼物' THEN '🎁'
    WHEN '请客' THEN '🍽️'
    WHEN '慈善捐款' THEN '❤️'
    -- 金融保险
    WHEN '保险费' THEN '🛡️'
    WHEN '投资理财' THEN '📊'
    WHEN '利息支出' THEN '🏦'
    -- 宠物
    WHEN '宠物食品' THEN '🦴'
    WHEN '宠物医疗' THEN '🐕'
    WHEN '宠物用品' THEN '🐾'
    -- 其他支出
    WHEN '其他' THEN '📦'
    -- 工资薪酬
    WHEN '工资' THEN '💵'
    WHEN '奖金' THEN '🏆'
    WHEN '补贴' THEN '💳'
    WHEN '年终奖' THEN '🎊'
    -- 兼职副业
    WHEN '兼职' THEN '👨‍💻'
    WHEN '稿费' THEN '✍️'
    WHEN '咨询费' THEN '💬'
    WHEN '平台收入' THEN '🌐'
    -- 投资收益
    WHEN '利息' THEN '🏦'
    WHEN '股票分红' THEN '📈'
    WHEN '基金收益' THEN '💹'
    WHEN '房租收入' THEN '🔑'
    -- 人情收入
    WHEN '收到红包' THEN '🧧'
    WHEN '收到礼金' THEN '💰'
    -- 其他收入
    WHEN '退款' THEN '↩️'
    WHEN '报销' THEN '🧾'
    WHEN '中奖' THEN '🎰'
    ELSE icon
END
WHERE user_id IS NULL AND icon = '📎';
