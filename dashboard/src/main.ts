import { createApp } from "vue";
import App from "./App.vue";
import "./styles/dashboard.css";
import "./styles/morphism.css";
import { initializeLabPalette } from "./theme.ts";

initializeLabPalette();
createApp(App).mount("#app");
