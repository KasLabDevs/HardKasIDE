/**
 * Turns the text of a failed node operation (CLI error line, Docker message, timeout) into a plain cause and
 * what to do about it. Only well-known failures get a hint; anything else returns null and the raw error stays.
 */
export interface NodeErrorHint {
  /** What went wrong, in one short sentence. */
  cause: string;
  /** What the user can do about it. */
  fix: string;
  /** The fix happens outside the IDE (Docker Desktop, another program): "Try again" is the next step after it. */
  external?: boolean;
}

const RULES: Array<{ test: RegExp; hint: NodeErrorHint }> = [
  {
    test: /docker daemon|docker_engine|dockerDesktopLinuxEngine|is the docker daemon running|error during connect|docker desktop is (?:not running|stopped|starting)|cannot connect to the docker/i,
    hint: {
      cause: "Docker is not running, so the local node (rusty-kaspad in a container) cannot start.",
      fix: "Start Docker Desktop, wait until it says it is running, then try again.",
      external: true
    }
  },
  {
    test: /(?:docker|['"`]?docker['"`]?)[^\n]{0,40}(?:not recognized|not found|ENOENT)|no such file or directory[^\n]{0,40}docker/i,
    hint: {
      cause: "Docker is not installed (or not on the PATH), and the local node runs in a Docker container.",
      fix: "Install Docker Desktop, open it once, then try again. The simulator target works without Docker.",
      external: true
    }
  },
  {
    test: /port is already allocated|address already in use|EADDRINUSE|only one usage of each socket address|bind: .*(?:in use|permission denied)/i,
    hint: {
      cause: "A port the node needs is taken by another program (often another node or a second container).",
      fix: "Stop the other node or container (docker ps shows it), or reset the local node, then try again.",
      external: true
    }
  },
  {
    test: /pull access denied|manifest unknown|TLS handshake timeout|i\/o timeout|no such host|failed to resolve reference|net\/http: request canceled/i,
    hint: {
      cause: "Docker could not download the node image (no network, a proxy, or the registry did not answer).",
      fix: "Check your internet connection and that Docker can reach Docker Hub, then try again."
    }
  },
  {
    test: /no space left on device|disk (?:is )?full/i,
    hint: {
      cause: "The disk (or Docker's virtual disk) is full.",
      fix: "Free some space, for example with docker system prune in a terminal, then try again.",
      external: true
    }
  },
  {
    test: /another workspace|belongs to (?:a different|another) (?:project|workspace)/i,
    hint: {
      cause: "The running node holds the chain of another project.",
      fix: "Stop it from that project, or reset the local node here to start a fresh chain."
    }
  },
  {
    test: /did not answer on RPC|RPC (?:is )?not ready|ECONNREFUSED/i,
    hint: {
      cause: "The node started but did not answer on its RPC port in time. The first start downloads the image and can take a few minutes.",
      fix: "Try again. If it keeps failing, the Console shows the container's output."
    }
  },
  {
    test: /hardkas[^\n]{0,40}(?:not recognized|not found|ENOENT)|cannot find module[^\n]*hardkas/i,
    hint: {
      cause: "The HardKas CLI is missing from this project.",
      fix: "Install the project's dependencies (pnpm install in a terminal), then try again."
    }
  }
];

export function nodeErrorHint(text: string | null | undefined): NodeErrorHint | null {
  if (!text) return null;
  for (const rule of RULES) if (rule.test.test(text)) return rule.hint;
  return null;
}
