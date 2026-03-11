
const express = require("express");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

cloudinary.config({
  cloud_name: "djfrffdgf",
  api_key: "953331757586729",
  api_secret: process.env.CLOUDINARY_SECRET
});

router.post("/upload-photo", upload.single("photo"), async (req, res) => {
  try {
    const file = req.file;

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "sfv",
          resource_type: "image"
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      stream.end(file.buffer);
    });

    res.json({
      url: result.secure_url
    });

  } catch (err) {
    console.error("Cloudinary upload error:", err);
    res.status(500).json({ error: "upload failed" });
  }
});

module.exports = router;
