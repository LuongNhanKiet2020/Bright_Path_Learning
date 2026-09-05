import { Router } from 'express';
import * as controller from '../controllers/lesson-controller';

export const lessonRouter = Router();

lessonRouter.post('/', controller.create);
lessonRouter.post('/:id/move', controller.move);
lessonRouter.post('/:id/cancel', controller.cancel);
lessonRouter.post('/:id/no-show', controller.noShow);
lessonRouter.get('/:id/history', controller.history);
