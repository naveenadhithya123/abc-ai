import { Router } from "express";
import { uploadDocument } from "../controllers/document.controller.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

router.post("/upload", upload.single("file"), uploadDocument);

export default router;
