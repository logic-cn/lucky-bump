#!/usr/bin/env python3
"""生成 uniCloud 集合索引文件（{collection}.index.json）。

索引与查询路径对应：所有业务查询都按 journey_id / baby_id + 时间排序，
鉴权按 user_id，短信/邀请按唯一键。可按需重跑（覆盖同名索引文件）。
"""
from __future__ import annotations

import json
import pathlib

_ROOT = pathlib.Path(__file__).resolve().parent.parent
_CLOUD = next((n for n in ('uniCloud-alipay', 'uniCloud-aliyun', 'uniCloud-tcb') if (_ROOT / n).is_dir()), 'uniCloud-alipay')
BASE = _ROOT / _CLOUD / 'database'


def idx(name: str, keys: list[tuple[str, str]], unique: bool = False) -> dict:
    return {
        'IndexName': name,
        'MgoKeySchema': {
            'MgoIndexKeys': [{'Name': k, 'Direction': d} for k, d in keys],
            'MgoIsUnique': unique,
        },
    }


INDEXES: dict[str, list[dict]] = {
    'uni-id-users': [idx('uniq_username', [('username', '1')], True), idx('idx_mobile', [('mobile', '1')])],
    'lb-token': [idx('uniq_jti', [('jti', '1')], True), idx('idx_uid', [('uid', '1')])],
    'lb-journeys': [idx('idx_user_created', [('user_id', '1'), ('created_at', '-1')])],
    'lb-daily-logs': [idx('idx_journey_ts', [('journey_id', '1'), ('ts', '-1')]),
                      idx('idx_journey_code_ts', [('journey_id', '1'), ('code', '1'), ('ts', '-1')])],
    'lb-cycle-events': [idx('idx_journey_ts', [('journey_id', '1'), ('ts', '-1')])],
    'lb-cycles': [idx('idx_journey_start', [('journey_id', '1'), ('start_date', '1')])],
    'lb-tracker-sessions': [idx('idx_journey_started', [('journey_id', '1'), ('started_at', '-1')])],
    'lb-diaries': [idx('idx_journey_ts', [('journey_id', '1'), ('ts', '-1')]),
                   idx('idx_journey_client', [('journey_id', '1'), ('client_id', '1')])],
    'lb-screenings': [idx('idx_journey_type_ts', [('journey_id', '1'), ('type', '1'), ('ts', '-1')])],
    'lb-prenatal-visits': [idx('idx_journey_visit', [('journey_id', '1'), ('visit_ts', '-1')])],
    'lb-schedule-items': [idx('idx_journey_plan', [('journey_id', '1'), ('plan_date', '1')])],
    'lb-feedings': [idx('idx_baby_ts', [('baby_id', '1'), ('ts', '-1')]),
                    idx('idx_journey_ts', [('journey_id', '1'), ('ts', '-1')])],
    'lb-diaper-changes': [idx('idx_baby_ts', [('baby_id', '1'), ('ts', '-1')])],
    'lb-sleep-sessions': [idx('idx_baby_start', [('baby_id', '1'), ('start_ts', '-1')])],
    'lb-growth-samples': [idx('idx_baby_measure', [('baby_id', '1'), ('measure_date', '1')])],
    'lb-vaccinations': [idx('idx_baby_date', [('baby_id', '1'), ('date', '1')])],
    'lb-milestones': [idx('idx_baby_achieved', [('baby_id', '1'), ('achieved_date', '1')])],
    'lb-food-logs': [idx('idx_baby_ts', [('baby_id', '1'), ('ts', '-1')]),
                     idx('idx_journey_name', [('journey_id', '1'), ('name', '1')])],
    'lb-medication-logs': [idx('idx_journey_ts', [('journey_id', '1'), ('ts', '-1')])],
    'lb-child-health': [idx('idx_baby_ts', [('baby_id', '1'), ('ts', '-1')])],
    'lb-album': [idx('idx_journey_ts', [('journey_id', '1'), ('ts', '-1')]),
                 idx('idx_baby_ts', [('baby_id', '1'), ('ts', '-1')])],
    'lb-events': [idx('idx_journey_ts', [('journey_id', '1'), ('ts', '-1')]),
                  idx('idx_user_ts', [('user_id', '1'), ('ts', '-1')]),
                  idx('idx_event_date', [('event', '1'), ('date', '1')])],
    'lb-sms-codes': [idx('idx_phone_lookup', [('phone', '1'), ('purpose', '1'), ('used', '1'), ('created_at', '-1')]),
                     idx('idx_expiry', [('expires_at', '1')])],
    'lb-feedback': [idx('idx_status_created', [('status', '1'), ('created_at', '-1')]),
                    idx('idx_user', [('user_id', '1')])],
    'lb-reminder-rules': [idx('idx_journey', [('journey_id', '1')])],
    'lb-reminder-done': [idx('idx_journey_due', [('journey_id', '1'), ('due_date', '1')])],
    'lb-audit-logs': [idx('idx_journey_date', [('journey_id', '1'), ('date', '1')])],
    'lb-families': [idx('idx_owner', [('owner_id', '1')]), idx('idx_journey', [('journey_id', '1')])],
    'lb-family-members': [idx('uniq_family_user', [('family_id', '1'), ('user_id', '1')], True),
                          idx('idx_user', [('user_id', '1')])],
    'lb-family-invites': [idx('uniq_code', [('code', '1')], True), idx('idx_family', [('family_id', '1')])],
}


TYPE_MAP = {
    'string': 'varchar', 'long': 'long', 'int': 'int',
    'bool': 'bool', 'double': 'double', 'array': 'array',
}


def schema_types(collection: str) -> dict[str, str]:
    """读取 schema 字段 bsonType，支付宝云索引要求为每个字段标注 Type。"""
    path = BASE / f'{collection}.schema.json'
    try:
        props = json.loads(path.read_text(encoding='utf-8')).get('properties', {})
    except Exception:
        return {}
    return {k: v.get('bsonType', '') for k, v in props.items()}


def main() -> None:
    for collection, indexes in INDEXES.items():
        types = schema_types(collection)
        for index in indexes:
            for key in index['MgoKeySchema']['MgoIndexKeys']:
                t = TYPE_MAP.get(types.get(key['Name'], ''))
                if t:
                    key['Type'] = t
        path = BASE / f'{collection}.index.json'
        path.write_text(json.dumps(indexes, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'generated {len(INDEXES)} index files')


if __name__ == '__main__':
    main()
