FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

WORKDIR /app

COPY services/adk-agent/pyproject.toml services/adk-agent/pyproject.toml
COPY services/adk-agent/ad_ops_advisor services/adk-agent/ad_ops_advisor

WORKDIR /app/services/adk-agent

RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4).read()"]

CMD ["python", "-m", "ad_ops_advisor.http_server"]
