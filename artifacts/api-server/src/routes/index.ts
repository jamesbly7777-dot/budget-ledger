import { Router, type IRouter } from "express";
import path from "path";
import { fileURLToPath } from "url";
import healthRouter from "./health";
import parseStatementRouter from "./parseStatement";

const router: IRouter = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

router.use(healthRouter);
router.use(parseStatementRouter);

router.get("/statement.jpg", (_req, res) => {
  const file = path.resolve(process.cwd(), "../ledger-app/dist/public/statement_clean.jpg");
  res.sendFile(file);
});

export default router;
