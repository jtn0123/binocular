const { withAppBuildGradle, withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');

/**
 * Makes the CI APK build stop redoing work it has already done.
 *
 * Measured on the first build containing ExecuTorch (run 12): 19m51s of
 * Gradle, ending in "956 actionable tasks: 956 executed" — nothing reused,
 * nothing up-to-date. The workflow already caches ~/.gradle/caches, but that
 * only holds *downloaded dependencies*; without the build cache enabled, no
 * task output survives a run. Run 11 got a clean cache hit and still took
 * ~17 minutes, which is the proof that downloads were never the bottleneck.
 *
 * android/ is generated (CNG) and gitignored, so these settings have to be
 * written on every prebuild rather than committed — same reason
 * withGradleDaemonJvm.js exists.
 */

/** Reads/writes the `key=value` array shape expo uses for gradle.properties. */
function setProperty(properties, key, value) {
  const existing = properties.find((p) => p.type === 'property' && p.key === key);
  if (existing) {
    existing.value = value;
    return properties;
  }
  properties.push({ type: 'property', key, value });
  return properties;
}

const withGradleTuning = (config) =>
  withGradleProperties(config, (cfg) => {
    // Task outputs are content-addressed, so a freshly generated android/
    // directory stops mattering: the cache is keyed on inputs, not paths.
    // build-cache-1 lives inside ~/.gradle/caches, which CI already caches.
    setProperty(cfg.modResults, 'org.gradle.caching', 'true');
    // The template ships 2 GB. A GitHub runner has 16, and Kotlin/Java
    // compilation of this many modules is exactly what a small heap punishes.
    setProperty(cfg.modResults, 'org.gradle.jvmargs', '-Xmx6144m -XX:MaxMetaspaceSize=1024m');
    return cfg;
  });

const withoutReleaseLint = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('checkReleaseBuilds')) return cfg;
    // lintVitalRelease and the lintVitalAnalyzeRelease it pulls in across
    // every module cost ~2 minutes. It exists to catch store-blocking issues
    // in a shipped release; these are field-test APKs installed by hand, and
    // lint still runs in the app's own checks.
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /^android \{/m,
      'android {\n    lint {\n        checkReleaseBuilds false\n    }\n',
    );
    return cfg;
  });

const withSingleNdk = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('binocular:single-ndk')) return cfg;
    // The build installed TWO NDKs (27.1.12297006 and 27.0.12077973): the app
    // and the expo modules take rootProject.ext.ndkVersion, while third-party
    // modules that never declare one fall back to whatever their AGP defaults
    // to. That is ~1 minute and several GB of runner disk — and disk is not
    // spare here, since ExecuTorch's build already exhausted it once.
    //
    // Inserted BEFORE the root plugins rather than appended: they evaluate
    // subprojects eagerly, and afterEvaluate throws outright once a project
    // has been evaluated ("Cannot run Project.afterEvaluate(Closure) when the
    // project is already evaluated"). Registering first is what makes the
    // callback legal; it still runs late enough to see ext.ndkVersion, which
    // expo-root-project sets. The state.executed guard means a future
    // reordering degrades to a no-op instead of a failed build.
    const block = `// binocular:single-ndk — one NDK for every module, so CI installs one.
subprojects { subproject ->
  def pinNdk = {
    if (subproject.hasProperty('android') && rootProject.ext.has('ndkVersion')) {
      subproject.android.ndkVersion = rootProject.ext.ndkVersion
    }
  }
  if (subproject.state.executed) {
    pinNdk()
  } else {
    subproject.afterEvaluate { pinNdk() }
  }
}

apply plugin: "expo-root-project"`;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /^apply plugin: "expo-root-project"/m,
      block,
    );
    return cfg;
  });

module.exports = (config) => withSingleNdk(withoutReleaseLint(withGradleTuning(config)));
