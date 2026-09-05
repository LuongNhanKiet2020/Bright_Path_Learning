import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { lessonRouter } from './routes/lesson-routes';
import { AppError } from './lib/errors';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/lessons', lessonRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'INVALID_INPUT', issues: err.issues });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json(err.body);
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'INTERNAL' });
  });

  return app;
}
