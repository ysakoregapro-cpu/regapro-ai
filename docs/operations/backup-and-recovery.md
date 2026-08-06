# Backup and Recovery / バックアップと復旧

Regapro AI のデータバックアップ・復旧手順。

## Backup Strategy / バックアップ戦略

| Component | Method | Frequency | Retention |
|---|---|---|---|
| PostgreSQL (Supabase) | Supabase automated + manual pg_dump | Daily (auto) + Weekly (manual) | 30 days |
| Storage (artifacts) | Supabase Storage replication | Continuous | 30 days |
| Environment config | Git + secret manager | On change | Indefinite |
| SearXNG | Not backed up (stateless) | — | — |

## Supabase Automated Backups / Supabase 自動バックアップ

- **Pro plan+:** Daily automated backups, 7-day retention
- **Team plan+:** Daily backups, 14-day retention
- **Enterprise:** Point-in-time recovery (PITR)

Dashboard → Settings → Database → Backups

## Manual Backup / 手動バックアップ

### Full Database Dump / フルダンプ

```bash
# Local
npx supabase db dump -f backup_$(date +%Y%m%d).sql

# Remote (linked project)
npx supabase db dump --linked -f backup_$(date +%Y%m%d).sql
```

### Schema Only / スキーマのみ

```bash
npx supabase db dump --schema-only -f schema_$(date +%Y%m%d).sql
```

### Storage Backup / ストレージ

```bash
# List and download artifacts bucket
npx supabase storage ls artifacts/
# Manual download via Supabase client or Dashboard
```

## Recovery Procedures / 復旧手順

### Scenario 1: Accidental Data Delete / 誤削除

1. Identify affected tables and timeframe
2. Restore from latest backup to staging environment
3. Extract affected rows
4. Re-insert into production via Application Service
5. Verify RLS policies intact

```bash
# Restore to local staging
psql -h localhost -p 54322 -U postgres -d postgres < backup_20260806.sql
```

### Scenario 2: Migration Failure / マイグレーション失敗

1. Stop application deployments
2. Assess migration impact
3. Write reverse migration SQL
4. Apply reverse migration
5. Restore from backup if reverse insufficient
6. Re-deploy previous application version

See [Migration Operation](./migration-operation.md).

### Scenario 3: Full Disaster Recovery / 完全災害復旧

1. Create new Supabase project (or restore from Supabase backup)
2. Apply all migrations: `npx supabase db push`
3. Restore data from latest pg_dump
4. Update environment variables
5. Deploy application
6. Verify: `npm run check` + smoke tests
7. Update DNS if needed

### Scenario 4: Supabase PITR (Enterprise) / ポイントインタイム復旧

Dashboard → Settings → Database → Backups → Restore to new project

## Recovery Time Objectives / 復旧目標

| Scenario | RTO | RPO |
|---|---|---|
| Single table restore | 1 hour | 24 hours |
| Full DB restore | 4 hours | 24 hours |
| Complete disaster | 8 hours | 24 hours |

## Backup Verification / バックアップ検証

Weekly cron job (`backup-verify`):

```bash
# 1. Restore latest backup to temp database
# 2. Run schema validation
# 3. Count rows in critical tables
# 4. Log result to audit_logs
```

## Related / 関連

- [Cron](./cron.md)
- [Incident Response](./incident-response.md)
- [Migration Operation](./migration-operation.md)
