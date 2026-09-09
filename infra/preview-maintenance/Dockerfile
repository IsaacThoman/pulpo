FROM python:3.13-alpine
RUN apk add --no-cache docker-cli
COPY infra/preview-maintenance/cleanup.py /opt/pulpo/cleanup.py
# Coolify schedules the cleanup command; this container has no public listener.
CMD ["sleep", "infinity"]
