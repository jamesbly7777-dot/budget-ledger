import { Router, type IRouter } from "express";
import healthRouter from "./health";
import parseStatementRouter from "./parseStatement";

const router: IRouter = Router();

router.use(healthRouter);
router.use(parseStatementRouter);

export default router;
