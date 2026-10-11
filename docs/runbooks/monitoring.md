# Runbook: Monitoring

| Was                       | Wo                                                                                                                   | Alarm  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| Erreichbarkeit Produktion | UptimeRobot: Keyword-Monitor auf `https://smart.tillkosiol.de/api/health/ready`, Keyword `"status":"ok"`, alle 5 min | E-Mail |
| Nächtliches Backup        | healthchecks.io, Check „vps-backup“ (Cron `15 3 * * *`, UTC, Grace 2 h)                                              | E-Mail |
| Restore-Test              | healthchecks.io, Check „restore-test“ (Cron `45 4 1 * *`, UTC, Grace 6 h)                                            | E-Mail |
| Host/Container            | Beszel (bereits vorhanden)                                                                                           | –      |

## Logs

```bash
cd ~/docker/apps/smart-prod
docker compose --env-file .env --env-file deploy.env logs --since 1h api
```

API-Logs sind JSON; jede Anfrage hat eine `traceId`, die auch im Response-Header `x-trace-id` steht.
