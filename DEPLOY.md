# Бесплатное размещение RTU Todo на Render

Подготовлено: Docker с Node.js и Chromium, бесплатный Web Service в render.yaml,
проверка входа Supabase для API, отдельные профили RTU для каждого пользователя.
Новые таблицы Supabase не нужны.

## Публикация

1. Создай приватный репозиторий GitHub и загрузи исходники проекта.
   Не загружай node_modules, .rtu-session, .env и скриншоты.
2. Войди на https://dashboard.render.com/ и подключи репозиторий.
3. Создай Web Service, выбери Docker и тариф Free. Не выбирай Static Site.
   Вместо ручной настройки можно создать Blueprint из render.yaml.
4. Dockerfile устанавливает Chromium при сборке и запускает node server.js.
   Проверка здоровья: /health. RTU_HEADLESS=true, MAX_RTU_JOBS=1.
5. После появления статуса Live открой выданный адрес onrender.com.
6. В Supabase → Authentication → URL Configuration установи этот адрес
   как Site URL и добавь в разрешённые Redirect URLs для подтверждения почты.
7. Войди в RTU Todo. Введи свою RTU почту, запусти загрузку и подтверди
   число Authenticator на телефоне. Первый вход в RTU на сервере выполняется заново.

config.js содержит только публичный publishable/anon key. Можно переопределить
настройки переменными SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY в Render.
Не используй service_role/secret key в этом приложении.

## Ограничения Free

- Render засыпает после 15 минут без входящих запросов. Первый запрос после
  сна может открываться дольше обычного.
- Файлы и сессии RTU могут пропасть при перезапуске или публикации.
  Тогда потребуется повторный вход Microsoft. Задачи в Supabase сохраняются.
- Только одна синхронизация RTU одновременно, чтобы снизить расход памяти.
- Docker-сборка и работа Chromium на тарифе Free должны быть проверены на
  реальном сервисе. При нехватке памяти или запрете входа со стороны Microsoft
  полноценная автоматическая загрузка может не работать на этом тарифе.

Документация: https://render.com/docs/free и https://render.com/docs/docker.

## Локальная проверка

node --test tests/hosting.test.js

Docker при наличии установки: docker build -t rtu-todo .
Запуск: docker run --rm -p 8000:8000 rtu-todo

Не копируй существующую .rtu-session на хостинг.
