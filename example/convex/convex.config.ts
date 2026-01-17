import { defineApp } from "convex/server";
import debouncer from "@ikhrustalev/convex-debouncer/convex.config.js";

const app = defineApp();
app.use(debouncer);

export default app;
