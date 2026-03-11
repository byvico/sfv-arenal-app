const express = require("express");
const router = express.Router();
const pool = require("../db");

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

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Error guardando foto" });

  }

});

module.exports = router;