import { Router } from "express";
import { sendAnswerEmail } from "../controllers/email.controller.js";

const router = Router();

router.post("/send", sendAnswerEmail);

export default router;
