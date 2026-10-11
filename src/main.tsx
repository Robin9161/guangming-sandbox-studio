import { createRoot } from "react-dom/client";
import SandboxPage from "../app/sandbox/page";

// 不包 StrictMode：开发模式下它会把 3D 场景创建两次，加载变慢
createRoot(document.getElementById("root")!).render(<SandboxPage />);
