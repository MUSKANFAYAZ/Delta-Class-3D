# Render Deployment

This project can run on Render as a single Node web service.

## Service settings

- Service type: Web Service
- Environment: Node
- Build command: `npm run build`
- Start command: `npm start`
- Health check path: `/health`

The repository includes [render.yaml](render.yaml) with the same settings.

## Required environment variables

Set these in the Render dashboard:

- `MONGO_URI` - your MongoDB Atlas connection string
- `JWT_SECRET` - a strong secret for session/auth tokens

Optional variables:

- `DEBUG_LOGS=true` - enables extra server logging

## Notes

- The server listens on `process.env.PORT`, which is what Render provides.
- The built client is served from `client/dist` when the frontend build exists.
- The app is configured to use `MONGO_URI` only, so you do not need any Railway-specific database variables.

## Deploy flow

1. Push the branch to GitHub.
2. Create or connect a Render Web Service for this repo.
3. Add the environment variables above.
4. Deploy and open the service URL.
5. Check `/health` after the first successful deploy.