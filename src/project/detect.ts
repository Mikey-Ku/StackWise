/**
 * What kind of project a folder holds, how to run it, and where it answers when it's up. Pure:
 * the caller says which files exist and what the few small ones say. Detection only suggests;
 * the person picks the command StackWise runs, and can type their own.
 */

export interface RunCommand {
  label: string;
  command: string;
}

export interface Detected {
  /** A StackWise framework option id when one is recognized. */
  framework: string | null;
  label: string;
  commands: RunCommand[];
  /** Where the running app answers, for the health check. */
  healthUrl: string | null;
  /** The env files that exist, in the order the app reads them. */
  envFiles: string[];
  /** Config files that name env variables, like Spring's application.properties. */
  configFiles: string[];
  /** The Java version the build asks for, when it says. */
  javaVersion?: string;
}

const ENV_FILES = [".env.local", ".env", ".env.development.local", ".env.development"];

export function detectProject(has: (file: string) => boolean, read: (file: string) => string | null): Detected {
  const commands: RunCommand[] = [];
  let framework: string | null = null;
  let label = "Unknown project";
  let healthUrl: string | null = null;
  let javaVersion: string | undefined;

  const pkg = (() => {
    try {
      return JSON.parse(read("package.json") ?? "null") as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null;
    } catch {
      return null;
    }
  })();

  if (has("run-local.sh")) commands.push({ label: "run-local.sh", command: "./run-local.sh" });

  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) {
    const pom = read("pom.xml") ?? read("build.gradle") ?? read("build.gradle.kts") ?? "";
    javaVersion = pom.match(/<java\.version>\s*(\d+)\s*<\/java\.version>/)?.[1] ?? pom.match(/languageVersion\s*=\s*JavaLanguageVersion\.of\((\d+)\)/)?.[1];
    if (/spring-boot/.test(pom)) {
      framework = "spring-boot";
      label = "Spring Boot";
      healthUrl = /actuator/.test(pom) ? "http://localhost:8080/actuator/health" : "http://localhost:8080/";
    } else label = "Java";
    if (has("mvnw")) commands.push({ label: "Maven", command: "./mvnw spring-boot:run" });
    else if (has("gradlew")) commands.push({ label: "Gradle", command: "./gradlew bootRun" });
  } else if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const known: [string, string, string, number][] = [
      ["next", "nextjs", "Next.js", 3000],
      ["nuxt", "nuxt", "Nuxt", 3000],
      ["@sveltejs/kit", "sveltekit", "SvelteKit", 5173],
      ["astro", "astro", "Astro", 4321],
      ["react-router", "react-router", "React Router", 5173],
      ["express", "express", "Express", 3000],
      ["vite", "react-vite", "Vite", 5173],
    ];
    const hit = known.find(([dep]) => deps[dep]);
    if (hit) {
      [, framework, label] = hit;
      healthUrl = `http://localhost:${hit[3]}/`;
    } else label = "Node.js";
    for (const script of ["dev", "start"]) if (pkg.scripts?.[script]) commands.push({ label: `npm run ${script}`, command: `npm run ${script}` });
  } else if (has("manage.py")) {
    framework = "django";
    label = "Django";
    healthUrl = "http://localhost:8000/";
    commands.push({ label: "runserver", command: "python manage.py runserver" });
  } else if (has("Gemfile") && /rails/.test(read("Gemfile") ?? "")) {
    framework = "rails";
    label = "Rails";
    healthUrl = "http://localhost:3000/up";
    commands.push({ label: "rails server", command: "bin/rails server" });
  } else if (has("artisan")) {
    framework = "laravel";
    label = "Laravel";
    healthUrl = "http://localhost:8000/up";
    commands.push({ label: "artisan serve", command: "php artisan serve" });
  } else if (has("go.mod")) {
    framework = "go-net-http";
    label = "Go";
    healthUrl = "http://localhost:8080/";
    commands.push({ label: "go run", command: "go run ." });
  } else if (/fastapi/i.test(read("requirements.txt") ?? read("pyproject.toml") ?? "")) {
    framework = "fastapi";
    label = "FastAPI";
    healthUrl = "http://localhost:8000/docs";
    commands.push({ label: "uvicorn", command: "uvicorn main:app --reload" });
  }

  const configFiles = ["src/main/resources/application.properties", "src/main/resources/application.yml", "config/application.yml"].filter(has);
  return { framework, label, commands, healthUrl, envFiles: ENV_FILES.filter(has), configFiles, ...(javaVersion ? { javaVersion } : {}) };
}
