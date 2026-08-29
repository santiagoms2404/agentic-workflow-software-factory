import { createApp } from "vue";
import App from "./App.vue";
import "./styles/dashboard.css";
import { initializeLabPalette } from "./theme.ts";

initializeLabPalette();
createApp(App).mount("#app");
