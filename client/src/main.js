import "./styles.css";
import { renderClassroomPage } from "./classroomPage.js";
import { createClassroomLoader } from "./startup/classroomLoader.js";
import { registerServiceWorker } from "./startup/registerServiceWorker.js";
import { createRuntimeSession } from "./config/runtimeSession.js";

registerServiceWorker();

const app = document.getElementById("app");
const page = renderClassroomPage(app);
const session = createRuntimeSession(new URLSearchParams(window.location.search));

const classroomLoader = createClassroomLoader({
  loadButton: page.loadButton,
  setStatus: page.setStatus,
  role: session.role,
  canWriteBlackboard: session.canWriteBlackboard,
});

const warmupClassroomModules = () => {
  classroomLoader.warmup().catch(() => {
    // Warmup failures should not block user-initiated loading.
  });
};

page.loadButton.addEventListener("click", classroomLoader.handleLoadClick);
page.loadButton.addEventListener("mouseenter", warmupClassroomModules, { once: true });
page.loadButton.addEventListener("touchstart", warmupClassroomModules, { once: true });
page.loadButton.addEventListener("focus", warmupClassroomModules, { once: true });

if (classroomLoader.lowBandwidth) {
  page.setStatus("Low bandwidth detected. 3D is paused to keep the app responsive.", "Low bandwidth");
} else {
  page.setStatus("Ready to load the classroom.", "Idle");
  setTimeout(warmupClassroomModules, 900);
}
