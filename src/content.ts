/** Content script entry: installs quoting and conversation-tree enhancements. */
import { init } from "./core/enhancer";
import { initTree } from "./tree/panel";

init();
initTree();
