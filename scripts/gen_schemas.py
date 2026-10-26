#!/usr/bin/env python3
"""批量生成 uniCloud 数据库 schema。
安全约定（docs/06 §2）：permission 全部 false —— clientDB 完全关闭，所有读写经云对象鉴权。
"""
import json, os

BASE = os.path.join(os.path.dirname(__file__), '..', 'uniCloud-aliyun', 'database')
LOCKED = {"read": False, "create": False, "update": False, "delete": False}

def prop(b, title, enum=None, fmt=None):
    p = {"bsonType": b, "title": title}
    if enum: p["enum"] = enum
    if fmt: p["format"] = fmt
    return p

SCHEMAS = {
  "uni-id-users": {
    "required": ["username"],
    "properties": {
      "username": prop("string", "用户名"),
      "password": prop("string", "密码哈希(s2$)"),
      "nickname": prop("string", "昵称"),
      "avatar": prop("string", "头像"),
      "heightCm": prop("double", "身高cm"),
      "prePregnancyWeightKg": prop("double", "孕前体重kg"),
      "birthYear": prop("int", "出生年份"),
      "role": prop("array", "角色"),
      "status": prop("string", "状态", enum=["active", "disabled"]),
      "register_date": prop("long", "注册时间"),
      "last_login_date": prop("long", "最后登录")
    }
  },
  "lb-token": {
    "required": ["jti", "uid"],
    "properties": {
      "jti": prop("string", "token唯一ID"),
      "uid": prop("string", "用户ID"),
      "tokenExpired": prop("long", "过期时间"),
      "revoked": prop("bool", "已吊销")
    }
  },
  "lb-journeys": {
    "required": ["user_id", "stage_code"],
    "properties": {
      "user_id": prop("string", "所属用户"),
      "title": prop("string", "旅程名"),
      "stage_code": prop("string", "阶段", enum=["PRECONCEPTION", "PREGNANT", "POSTPARTUM", "MOURNING", "ARCHIVED"]),
      "lmp_date": prop("long", "末次月经锚点(UTC正午)"),
      "edd": prop("long", "预产期锚点"),
      "edd_source": prop("string", "预产期来源", enum=["LMP", "OVULATION", "IVF_D3", "IVF_D5", "USER", "ULTRASOUND"]),
      "ultrasound_locked": prop("bool", "已做孕早期B超校正"),
      "fetus_count": prop("int", "胎数"),
      "high_risk": prop("bool", "高危妊娠"),
      "delivery_date": prop("long", "分娩日期"),
      "delivery_mode": prop("string", "分娩方式", enum=["vaginal", "c_section", "assisted"]),
      "delivery_hospital": prop("string", "分娩医院"),
      "baby_ids": prop("array", "宝宝ID列表"),
      "mourning_since": prop("long", "哀伤模式开始时间"),
      "mourning_reason": prop("string", "哀伤原因(仅本人)"),
      "from_journey_id": prop("string", "来源旅程(再备孕关联)"),
      "confirmed_at": prop("long", "好孕确认时间"),
      "created_at": prop("long", "创建时间"),
      "updated_at": prop("long", "更新时间")
    }
  },
  "lb-babies": {
    "required": ["journey_id", "user_id", "birth_date"],
    "properties": {
      "journey_id": prop("string", "旅程"), "user_id": prop("string", "用户"),
      "nickname": prop("string", "小名"), "sex": prop("string", "性别", enum=["male", "female", "unknown"]),
      "birth_date": prop("long", "出生日期"), "birth_weight_g": prop("int", "出生体重g"),
      "birth_length_cm": prop("double", "出生身长cm"), "delivery_mode": prop("string", "分娩方式"),
      "hospital": prop("string", "出生医院"), "created_at": prop("long", "创建时间")
    }
  },
  "lb-families": {
    "required": ["journey_id", "owner_id"],
    "properties": {
      "journey_id": prop("string", "旅程"), "owner_id": prop("string", "管理员(妈妈)"),
      "name": prop("string", "家庭名"), "matrix": prop("object", "数据组授权矩阵"), "created_at": prop("long", "创建时间")
    }
  },
  "lb-family-members": {
    "required": ["family_id", "user_id", "role"],
    "properties": {
      "family_id": prop("string", "家庭"), "user_id": prop("string", "成员"),
      "role": prop("string", "角色", enum=["admin", "recorder", "viewer"]),
      "nickname": prop("string", "昵称"), "joined_at": prop("long", "加入时间")
    }
  },
  "lb-family-invites": {
    "required": ["code", "family_id"],
    "properties": {
      "code": prop("string", "邀请码"), "family_id": prop("string", "家庭"),
      "journey_id": prop("string", "旅程"), "role": prop("string", "受邀角色"),
      "used": prop("bool", "已使用"), "expires_at": prop("long", "过期时间")
    }
  },
  "lb-cycles": {
    "required": ["user_id", "journey_id", "start_date"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"),
      "start_date": prop("long", "周期开始"), "end_date": prop("long", "周期结束(0=进行中)")
    }
  },
  "lb-cycle-events": {
    "required": ["user_id", "journey_id", "type", "ts"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"),
      "type": prop("string", "事件类型", enum=["period_start", "period_end", "ovulation_test", "bbt", "intercourse", "pregnancy_test"]),
      "value": prop("object", "事件数据"), "date": prop("string", "日期"),
      "ts": prop("long", "时间戳"), "sensitivity": prop("string", "敏感级", enum=["normal", "strict"])
    }
  },
  "lb-daily-logs": {
    "required": ["user_id", "journey_id", "code", "ts"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"),
      "code": prop("string", "指标码"), "value": prop("object", "指标值(白名单结构)"),
      "date": prop("string", "日期"), "ts": prop("long", "时间戳"),
      "stage_snapshot": prop("string", "孕周快照"), "sensitivity": prop("string", "敏感级")
    }
  },
  "lb-tracker-sessions": {
    "required": ["user_id", "journey_id", "type", "started_at"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"),
      "type": prop("string", "计时类型", enum=["contraction", "nursing", "pumping"]),
      "side": prop("string", "侧别", enum=["left", "right", ""]),
      "started_at": prop("long", "开始"), "ended_at": prop("long", "结束(0=进行中)"),
      "amount_ml": prop("int", "计量ml")
    }
  },
  "lb-prenatal-visits": {
    "required": ["user_id", "journey_id", "visit_ts"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"),
      "visit_ts": prop("long", "产检日期"), "hospital": prop("string", "医院"),
      "doctor": prop("string", "医生"), "week": prop("int", "孕周"),
      "items": prop("array", "检查项目与结果"), "cost_yuan": prop("double", "费用"),
      "conclusion": prop("string", "结论备注"), "report_file_ids": prop("array", "报告fileID"),
      "sensitivity": prop("string", "敏感级(reports)")
    }
  },
  "lb-schedule-items": {
    "required": ["user_id", "journey_id", "kind", "plan_date"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"),
      "kind": prop("string", "类型", enum=["prenatal", "prenatal_custom", "checkup", "vaccine"]),
      "week": prop("int", "建议孕周"), "plan_date": prop("long", "计划日期"),
      "title": prop("string", "标题"), "items": prop("array", "项目清单"),
      "prep": prop("string", "准备提醒"), "status": prop("string", "状态", enum=["upcoming", "done", "skipped"]),
      "note": prop("string", "备注")
    }
  },
  "lb-screenings": {
    "required": ["user_id", "journey_id", "type", "score"],
    "properties": {
      "user_id": prop("string", "用户(仅本人)"), "journey_id": prop("string", "旅程"),
      "type": prop("string", "量表", enum=["epds"]), "answers": prop("array", "答案"),
      "score": prop("int", "总分"), "self_harm": prop("bool", "第10题>0"),
      "ts": prop("long", "时间"), "sensitivity": prop("string", "敏感级(strict)")
    }
  },
  "lb-feedings": {
    "required": ["user_id", "journey_id", "baby_id", "mode", "ts"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"), "baby_id": prop("string", "宝宝"),
      "mode": prop("string", "方式", enum=["nursing", "breastmilk_bottle", "formula", "mixed"]),
      "side": prop("string", "侧别"), "ml": prop("int", "奶量"), "duration_sec": prop("int", "时长秒"),
      "date": prop("string", "日期"), "ts": prop("long", "时间")
    }
  },
  "lb-diaper-changes": {
    "required": ["user_id", "journey_id", "baby_id", "kind", "ts"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"), "baby_id": prop("string", "宝宝"),
      "kind": prop("string", "类型", enum=["pee", "poop", "both"]),
      "texture": prop("string", "性状"), "color": prop("string", "颜色"),
      "date": prop("string", "日期"), "ts": prop("long", "时间")
    }
  },
  "lb-sleep-sessions": {
    "required": ["user_id", "journey_id", "baby_id", "start_ts", "end_ts"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"), "baby_id": prop("string", "宝宝"),
      "kind": prop("string", "类型", enum=["night", "nap"]), "start_ts": prop("long", "入睡"),
      "end_ts": prop("long", "醒来"), "duration_min": prop("int", "时长分"),
      "night_wakings": prop("int", "夜醒次数"), "date": prop("string", "归属日期")
    }
  },
  "lb-growth-samples": {
    "required": ["user_id", "journey_id", "baby_id", "measure_date"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"), "baby_id": prop("string", "宝宝"),
      "measure_date": prop("long", "测量日"), "month_age": prop("int", "月龄"),
      "corrected": prop("bool", "矫正月龄"), "weight_kg": prop("double", "体重"),
      "height_cm": prop("double", "身高"), "head_cm": prop("double", "头围"),
      "source": prop("string", "来源", enum=["manual", "checkup", "ai_scan"])
    }
  },
  "lb-vaccinations": {
    "required": ["user_id", "journey_id", "baby_id", "code", "date"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"), "baby_id": prop("string", "宝宝"),
      "code": prop("string", "疫苗码"), "name": prop("string", "疫苗名"), "dose": prop("int", "剂次"),
      "free": prop("bool", "免疫规划"), "date": prop("long", "接种日"),
      "lot_no": prop("string", "批号"), "site": prop("string", "接种点"), "reaction_note": prop("string", "反应备注")
    }
  },
  "lb-milestones": {
    "required": ["user_id", "journey_id", "baby_id", "dim", "code"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"), "baby_id": prop("string", "宝宝"),
      "dim": prop("string", "维度", enum=["gross", "fine", "language", "social"]),
      "code": prop("string", "里程碑码"), "achieved_date": prop("long", "达成日"),
      "note": prop("string", "备注"), "media_ids": prop("array", "媒体")
    }
  },
  "lb-food-logs": {
    "required": ["user_id", "journey_id", "baby_id", "name", "ts"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"), "baby_id": prop("string", "宝宝"),
      "name": prop("string", "食物"), "ts": prop("long", "时间"), "date": prop("string", "日期"),
      "first": prop("bool", "首次添加"), "reaction": prop("string", "反应", enum=["", "none", "rash", "vomiting", "diarrhea", "other"]),
      "confirmed_allergy": prop("bool", "标记过敏")
    }
  },
  "lb-medication-logs": {
    "required": ["user_id", "journey_id", "name", "ts"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"), "baby_id": prop("string", "宝宝(可空=妈妈)"),
      "name": prop("string", "药名"), "dose": prop("string", "剂量(按说明书/医嘱)"),
      "ts": prop("long", "时间"), "date": prop("string", "日期"), "note": prop("string", "备注")
    }
  },
  "lb-reminder-rules": {
    "required": ["user_id", "journey_id", "type", "title"],
    "properties": {
      "user_id": prop("string", "用户"), "journey_id": prop("string", "旅程"),
      "type": prop("string", "规则类型", enum=["absolute", "by_week", "by_month", "recurring"]),
      "title": prop("string", "标题"), "anchor_date": prop("string", "锚点日期"),
      "week": prop("int", "孕周"), "month": prop("int", "月龄"), "interval_days": prop("int", "重复间隔天"),
      "lead_days": prop("int", "提前天数"), "urgent": prop("bool", "可突破免打扰"),
      "enabled": prop("bool", "启用"), "last_fired": prop("long", "上次触发")
    }
  }
}

def main():
    os.makedirs(BASE, exist_ok=True)
    for name, body in SCHEMAS.items():
        schema = dict(body)
        schema["permission"] = LOCKED
        path = os.path.join(BASE, f"{name}.schema.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(schema, f, ensure_ascii=False, indent=2)
    print(f"generated {len(SCHEMAS)} schemas in {os.path.relpath(BASE)}")

if __name__ == "__main__":
    main()
