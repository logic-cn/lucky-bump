/**
 * lucky-templates —— 领域模板数据（产检日程 / 国家免疫规划疫苗 / EPDS / 孕期增重 / 症状库 / 里程碑）
 * 数据口径来源：docs/03-核心功能详细设计.md（M3 产检模板、M5.5 疫苗程序表、M5.7 里程碑）。
 * 纯静态数据，供 lucky-care / lucky-baby / lucky-record 引用，避免 DB 依赖、便于版本化。
 */
'use strict'

/** 常规产检模板（单胎、无高危）。week 区间含端点；items 为常规项目摘要；prep 为检查前准备提醒。 */
const PRENATAL_PLAN = [
  { key: 'setup', weekFrom: 6, weekTo: 13, weekToDay: 6, title: '建档 + NT', items: ['建档问诊', 'NT 超声(11-13+6)', '血常规', '尿常规', '血型', '空腹血糖', '肝肾功能', '传染病筛查', '甲状腺功能', '心电图'], prep: '需空腹；携带身份证/医保卡；南方地区建议了解地贫筛查' },
  { key: 'tang', weekFrom: 14, weekTo: 19, weekToDay: 6, title: '唐氏筛查', items: ['中期唐筛(15-20周)或无创DNA(12-22周)', '宫高腹围', '血压体重'], prep: '唐筛需准确孕周，确认是否已 B 超校正' },
  { key: 'daopaiji', weekFrom: 20, weekTo: 24, weekToDay: 6, title: '系统超声（大排畸）', items: ['系统超声(大排畸)', '血常规', '尿常规'], prep: '无需空腹；建议提前 2-4 周预约' },
  { key: 'ogtt', weekFrom: 25, weekTo: 28, weekToDay: 6, title: '糖耐量试验（OGTT）', items: ['75g OGTT(空腹/1h/2h)', '血常规', '尿常规'], prep: '检查前空腹 8-12 小时' },
  { key: 'dev32', weekFrom: 29, weekTo: 32, weekToDay: 6, title: '生长发育超声', items: ['超声(生长发育)', '血常规', '尿常规'], prep: '' },
  { key: 'nst36', weekFrom: 33, weekTo: 36, weekToDay: 6, title: '胎心监护 + GBS', items: ['胎心监护(34周起)', 'B族链球菌筛查(35-37周)', '超声'], prep: '胎心监护前进食宝宝更配合' },
  { key: 'weekly', weekFrom: 37, weekTo: 40, weekToDay: 6, title: '足周每周产检', items: ['胎心监护', '超声估重', '宫颈评估'], prep: '核对待产包；确认入院路线与证件' }
]
/** 产检频率：28 周前每 4 周、28-36 每 2 周、36 后每周（用于在区间内铺点） */
const PRENATAL_CADENCE = [
  { weekFrom: 6, weekTo: 27, everyWeeks: 4 },
  { weekFrom: 28, weekTo: 35, everyWeeks: 2 },
  { weekFrom: 36, weekTo: 40, everyWeeks: 1 }
]
/** 多胎/高龄（≥35）高危口径：整体提前加密 */
const PRENATAL_HIGH_RISK_NOTE = '多胎/高龄/慢性病等高危妊娠产检更频更早，以医生产检单为准，可在 App 中自定义。'

/** 国家免疫规划疫苗程序表（2021 版口径）。月龄为月；dose 剂次；free=true 免费规划。 */
const VACCINE_PROGRAM = [
  { code: 'hepb1', name: '乙肝疫苗', dose: 1, ageMonths: 0, free: true },
  { code: 'bcg', name: '卡介苗', dose: 1, ageMonths: 0, free: true },
  { code: 'hepb2', name: '乙肝疫苗', dose: 2, ageMonths: 1, free: true },
  { code: 'polio1', name: '脊灰疫苗', dose: 1, ageMonths: 2, free: true },
  { code: 'polio2', name: '脊灰疫苗', dose: 2, ageMonths: 3, free: true },
  { code: 'dtp1', name: '百白破疫苗', dose: 1, ageMonths: 3, free: true },
  { code: 'polio3', name: '脊灰疫苗', dose: 3, ageMonths: 4, free: true },
  { code: 'dtp2', name: '百白破疫苗', dose: 2, ageMonths: 4, free: true },
  { code: 'dtp3', name: '百白破疫苗', dose: 3, ageMonths: 5, free: true },
  { code: 'hepb3', name: '乙肝疫苗', dose: 3, ageMonths: 6, free: true },
  { code: 'menA1', name: '流脑A疫苗', dose: 1, ageMonths: 6, free: true },
  { code: 'mmr1', name: '麻腮风疫苗', dose: 1, ageMonths: 8, free: true },
  { code: 'je1', name: '乙脑减毒疫苗', dose: 1, ageMonths: 8, free: true },
  { code: 'menA2', name: '流脑A疫苗', dose: 2, ageMonths: 9, free: true },
  { code: 'dtp4', name: '百白破疫苗', dose: 4, ageMonths: 18, free: true },
  { code: 'mmr2', name: '麻腮风疫苗', dose: 2, ageMonths: 18, free: true },
  { code: 'hepa1', name: '甲肝减毒疫苗', dose: 1, ageMonths: 18, free: true },
  { code: 'je2', name: '乙脑减毒疫苗', dose: 2, ageMonths: 24, free: true },
  { code: 'menAC1', name: '流脑A+C疫苗', dose: 1, ageMonths: 36, free: true },
  { code: 'polio4', name: '脊灰疫苗', dose: 4, ageMonths: 48, free: true },
  { code: 'dt1', name: '白破疫苗', dose: 1, ageMonths: 72, free: true },
  { code: 'menAC2', name: '流脑A+C疫苗', dose: 2, ageMonths: 72, free: true }
]
/** 自费疫苗清单（自愿、自费，接种前咨询门诊） */
const VACCINE_SELF_PAID = [
  { code: 'pneu13', name: '13价肺炎疫苗', ages: '1.5-7月龄基础', free: false },
  { code: 'rota', name: '轮状病毒疫苗', ages: '2月龄起口服', free: false },
  { code: 'flu', name: '流感疫苗', ages: '6月龄起每年', free: false },
  { code: 'ev71', name: '手足口(EV71)疫苗', ages: '6月龄-5岁', free: false },
  { code: 'varicella', name: '水痘疫苗', ages: '12月龄、4岁', free: false },
  { code: 'pentav', name: '五联疫苗', ages: '替代方案，咨询门诊', free: false }
]

/** EPDS 爱丁堡产后抑郁量表（10 题，0-3 分制）。q10 为自伤意念，>0 特殊处理。 */
const EPDS_ITEMS = [
  { id: 1, text: '我能够笑并看到事情有趣的一面' },
  { id: 2, text: '我期待着享受快乐的事物' },
  { id: 3, text: '当事情出错时，我会不必要地责备自己' },
  { id: 4, text: '我无缘无故感到焦虑或担心' },
  { id: 5, text: '我无缘无故感到害怕或惊慌' },
  { id: 6, text: '事情发展到我无法应付的地步' },
  { id: 7, text: '我因心情不好而影响睡眠' },
  { id: 8, text: '我感到悲伤或痛苦' },
  { id: 9, text: '我很不快乐，我哭泣' },
  { id: 10, text: '我曾想过伤害自己', special: 'self_harm' }
]
// 计分说明：1/2 两题反向（a 选项 3 分 → d 选项 0 分），其余正向。由服务端统一计分。

/** 孕期体重增重（IOM 口径，按孕前 BMI，kg）。weekly 为孕中晚期周增重参考。 */
const WEIGHT_GAIN = [
  { bmiFrom: 0, bmiTo: 18.5, label: '偏瘦', total: [12.5, 18.0], weekly: 0.5 },
  { bmiFrom: 18.5, bmiTo: 24.0, label: '正常', total: [11.5, 16.0], weekly: 0.4 },
  { bmiFrom: 24.0, bmiTo: 28.0, label: '超重', total: [7.0, 11.5], weekly: 0.3 },
  { bmiFrom: 28.0, bmiTo: 999, label: '肥胖', total: [5.0, 9.0], weekly: 0.2 }
]

/** 常见症状码库（快捷打卡） */
const SYMPTOMS = [
  { code: 'nausea', label: '孕吐' }, { code: 'fatigue', label: '乏力' }, { code: 'edema', label: '水肿' },
  { code: 'insomnia', label: '失眠' }, { code: 'backache', label: '腰痛' }, { code: 'cramp', label: '腿抽筋' },
  { code: 'constipation', label: '便秘' }, { code: 'heartburn', label: '烧心' }, { code: 'dizzy', label: '头晕' },
  { code: 'low_mood', label: '情绪低落' }
]
/** 症状红线触发词（出现即返回对应指引） */
const SYMPTOM_REDLINES = [
  { codes: ['bleeding'], action: '孕期出血请立即就医' },
  { codes: ['severe_pain'], action: '剧烈腹痛请立即就医' },
  { codes: ['reduced_fm'], action: '胎动明显减少：安静侧卧观察 1 小时，仍少请联系医生或就诊' },
  { codes: ['water_broke'], action: '破水：平躺并立即前往医院' }
]

/** 里程碑（参考月龄，月）。每个宝宝节奏不同，未达标仅提示儿保沟通。 */
const MILESTONES = [
  { dim: 'gross', code: 'head_up', label: '俯卧抬头', months: [1, 3] },
  { dim: 'gross', code: 'roll_over', label: '翻身', months: [3, 5] },
  { dim: 'gross', code: 'sit_alone', label: '独坐', months: [5, 7] },
  { dim: 'gross', code: 'crawl', label: '爬行', months: [7, 10] },
  { dim: 'gross', code: 'stand_assisted', label: '扶站', months: [9, 11] },
  { dim: 'gross', code: 'walk_alone', label: '独走', months: [11, 15] },
  { dim: 'fine', code: 'grasp', label: '抓握', months: [3, 5] },
  { dim: 'fine', code: 'transfer', label: '双手传递物品', months: [5, 7] },
  { dim: 'fine', code: 'pincer', label: '拇指食指对捏', months: [8, 10] },
  { dim: 'language', code: 'babble', label: '咿呀发声', months: [3, 6] },
  { dim: 'language', code: 'mama_dada', label: '有意叫爸爸妈妈', months: [10, 14] },
  { dim: 'language', code: 'words_combo', label: '说短句/双词', months: [16, 22] },
  { dim: 'social', code: 'stranger_aware', label: '认生', months: [5, 8] },
  { dim: 'social', code: 'wave_bye', label: '挥手再见/互动游戏', months: [8, 12] }
]

module.exports = { PRENATAL_PLAN, PRENATAL_CADENCE, PRENATAL_HIGH_RISK_NOTE, VACCINE_PROGRAM, VACCINE_SELF_PAID, EPDS_ITEMS, WEIGHT_GAIN, SYMPTOMS, SYMPTOM_REDLINES, MILESTONES }
