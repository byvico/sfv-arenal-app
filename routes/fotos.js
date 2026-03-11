
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { broadcast } = require("../events");

router.post("/", async (req, res) => {
  try {

    const {
      item,
      slot_idx,
      url,
      cuadrilla,
      proyecto
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO fotos
      (item, slot_idx, url, cuadrilla, proyecto)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [item, slot_idx, url, cuadrilla, proyecto]
    );

    const foto = result.rows[0];

    broadcast(proyecto, "control_update", {
      action: "photo_added",
      item,
      slot: slot_idx,
      url
    });

    res.json(foto);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error guardando foto" });
  }
});

module.exports = router;
