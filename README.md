# Health Tracker

Personal health tracking app for weight loss, reverse diet, meal planning and daily accountability.

## Stack

- React + TypeScript + Vite
- Tailwind CSS v4
- Chart.js
- Vercel serverless functions
- GitHub JSON files as source of truth
- GitHub Actions cron for morning and evening prompts

## Local setup

```bash
npm install
npm run dev
```

For read-only frontend testing, `npm run dev` is enough.

To test API writes locally, create `.env.local` with `ALLOW_LOCAL_WRITES=true`, then run:

```bash
npm run dev:api
```

The frontend reads bundled JSON files from `data/`. API writes require GitHub secrets in production, or `ALLOW_LOCAL_WRITES=true` with `npm run dev:api` in local development.

## Required environment variables

Copy `.env.example` and configure these in Vercel:

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `TASK_SECRET`
- `SLACK_WEBHOOK_URL`

Configure this GitHub Actions secret in the repo:

- `APP_BASE_URL`, for example `https://health-tracker.vercel.app`

## Data files

- `data/DATABASE_RECETTES.json`: writable recipe database
- `data/TRACKING_LOG_2026.json`: daily weight, calories, macros and training log
- `data/CONFIG_REVERSE_DIET.json`: phases, targets and training schedule
- `data/MEAL_PLAN_WEEK*.json`: weekly meal plans

## API

- `GET /api/health`
- `GET /api/tracking/latest?limit=7`
- `POST /api/tracking/log`
- `GET /api/recipes?search=riz&max_kcal=600`
- `POST /api/recipes`
- `GET /api/meal-plan/[weekId]`
- `POST /api/meal-plan/generate`
- `POST /api/tasks/morning`
- `POST /api/tasks/evening`
