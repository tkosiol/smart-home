FROM alpine:3.24.2
RUN apk add --no-cache restic postgresql17-client supercronic curl tzdata \
 && adduser -D -u 10001 backup \
 # Mount point for file-based repositories (local and stack tests); production uses B2.
 && install -d -o backup -g backup /restic-repo
COPY --chmod=0755 backup.sh restore-test.sh /usr/local/bin/
COPY crontab /etc/smart-backup.crontab
ENV TZ=UTC RESTIC_CACHE_DIR=/tmp/restic-cache
USER backup
CMD ["supercronic", "-passthrough-logs", "/etc/smart-backup.crontab"]
