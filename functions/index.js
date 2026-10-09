const express = require("express");
const cors = require("cors");
const { onRequest } = require("firebase-functions/v2/https");
const {
  REGION,
  INSTAGRAM_APP_ID,
  INSTAGRAM_APP_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  ANTHROPIC_API_KEY,
} = require("./src/config");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.use("/api", require("./src/routes/status").router);
app.use("/api", require("./src/routes/reviews").router);
app.use("/api", require("./src/routes/reply").router);
app.use("/api", require("./src/routes/aiGenerate").router);
app.use("/api", require("./src/routes/googleConnect").router);
app.use("/api", require("./src/routes/instagramConnect").router);

exports.api = onRequest(
  {
    region: REGION,
    secrets: [
      INSTAGRAM_APP_ID,
      INSTAGRAM_APP_SECRET,
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      ANTHROPIC_API_KEY,
    ],
  },
  app
);
