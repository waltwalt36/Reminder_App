FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY django_app/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY django_app ./django_app
WORKDIR /app/django_app

# Railway supplies $PORT. Migrations run at boot so a deploy never serves
# against a schema it does not match.
CMD python manage.py migrate --noinput && python manage.py flushexpiredtokens && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 60
