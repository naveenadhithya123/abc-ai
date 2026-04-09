import { Router } from "express";
import {
  getChatHistory,
  sendMessage,
} from "../controllers/chat.controller.js";

const router = Router();

router.post("/", sendMessage);
router.get("/:userId/history", getChatHistory);

export default router;
