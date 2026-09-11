import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const submissionMode = argumentsList.includes("--submission");
const platformArguments = argumentsList.filter((argument) => argument.startsWith("--platform="));
const unknownArguments = argumentsList.filter((argument) => (
  argument !== "--submission" && !argument.startsWith("--platform=")
));

if (unknownArguments.length > 0) {
  console.error(`Unknown store-readiness argument: ${unknownArguments.join(", ")}`);
  process.exit(2);
}
if (platformArguments.length > 1) {
  console.error("Provide --platform only once.");
  process.exit(2);
}
const submissionPlatform = platformArguments[0]?.slice("--platform=".length) || "all";
if (!new Set(["ios", "android", "all"]).has(submissionPlatform)) {
  console.error("--platform must be ios, android, or all.");
  process.exit(2);
}
if (!submissionMode && platformArguments.length > 0) {
  console.error("--platform is available only together with --submission.");
  process.exit(2);
}

function readText(path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

const failures = [];
let passed = 0;

function check(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(message);
}

function hasPlugin(plugins, name) {
  return plugins.some((plugin) => plugin === name || (Array.isArray(plugin) && plugin[0] === name));
}

function pluginOptions(plugins, name) {
  const plugin = plugins.find((candidate) => Array.isArray(candidate) && candidate[0] === name);
  return plugin?.[1] ?? null;
}

function readPngMetadata(relativePath) {
  const bytes = readFileSync(resolve(repositoryRoot, relativePath));
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature)) {
    return { valid: false, width: 0, height: 0, hasAlpha: true };
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  let offset = 8;
  let hasTransparencyChunk = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "tRNS") hasTransparencyChunk = true;
    offset += 12 + length;
    if (type === "IEND") break;
  }

  return {
    valid: true,
    width,
    height,
    hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
  };
}

const rootPackage = readJson("package.json");
const mobilePackage = readJson("apps/mobile/package.json");
const appConfig = readJson("apps/mobile/app.json").expo;
const easConfig = readJson("apps/mobile/eas.json");
const storeMetadata = readJson("apps/mobile/store-metadata.json");
const versionContract = readText("packages/contracts/src/mobile-v1.ts");
const rootLayout = readText("apps/mobile/app/_layout.tsx");
const websiteShell = readText("apps/mobile/src/components/website-app-shell.tsx");
const navigation = readText("apps/mobile/src/web/website-navigation.ts");
const pushNavigationRecovery = readText("apps/mobile/src/web/push-navigation-recovery.ts");
const installedIphoneWorkflow = readText("apps/mobile/.eas/workflows/iphone-installed-preview.yml");
const iosTestflightWorkflow = readText("apps/mobile/.eas/workflows/ios-testflight.yml");
const githubWorkflow = readText(".github/workflows/mobile-preview.yml");
const submissionPack = readText("docs/mobile/app-store-connect-submission-pack.md");
const googlePlaySubmissionPack = readText("docs/mobile/google-play-submission-pack.md");
const fullExchangeEvidence = readText("docs/mobile/full-exchange-app-review-evidence.md");
const responsePlaybook = readText("docs/mobile/app-review-response-playbook.md");
const privateRecordTemplate = readText("docs/mobile/app-review-private-record-template.md");
const economicCalendarPlan = readText("docs/mobile/economic-calendar-post-release-plan.md");
const runbook = readText("docs/mobile/private-beta-release-runbook.md");
const reviewDryRun = readText("docs/mobile/app-review-dry-run.md");
const reviewSurfaceScript = readText("scripts/verify-mobile-review-surface.mjs");
const reviewRehearsal = readText("src/__tests__/app-review-rehearsal.test.ts");
const scaleRehearsal = readText("src/__tests__/marketplace-concurrency-scale.test.ts");
const releaseSafetyGate = readText("scripts/release-safety-gate.mjs");
const supportPage = readText("src/app/[locale]/support/page.tsx");
const userSafetyActions = readText("src/components/account/user-safety-actions.tsx");
const userBlockRoute = readText("src/app/api/alpha-exchange/user-blocks/[userId]/route.ts");
const exchangeStore = readText("src/lib/alpha-exchange-store.ts");
const tradeRoomPage = readText("src/components/sections/trade-room/trade-room-page.tsx");
const tradeRoomActions = readText("src/lib/trade-room-actions.ts");

check(appConfig.name === "Alpha Traders", "The iOS display name must remain Alpha Traders.");
check(rootPackage.scripts?.["mobile:store-readiness"] === "node scripts/verify-mobile-store-readiness.mjs", "The source-readiness command is not wired into the root package.");
check(rootPackage.scripts?.["mobile:store-readiness:submission"] === "node scripts/verify-mobile-store-readiness.mjs --submission --platform=all", "The combined iOS/Android submission gate is not wired into the root package.");
check(rootPackage.scripts?.["mobile:store-readiness:submission:ios"] === "node scripts/verify-mobile-store-readiness.mjs --submission --platform=ios", "The iOS submission gate is not wired into the root package.");
check(rootPackage.scripts?.["mobile:store-readiness:submission:android"] === "node scripts/verify-mobile-store-readiness.mjs --submission --platform=android", "The Android submission gate is not wired into the root package.");
check(rootPackage.scripts?.["mobile:review-rehearsal"] === "node ./node_modules/vitest/vitest.mjs run src/__tests__/app-review-rehearsal.test.ts", "The isolated full-Exchange reviewer rehearsal is not wired into the root package.");
check(rootPackage.scripts?.["mobile:scale-rehearsal"] === "node ./node_modules/vitest/vitest.mjs run src/__tests__/marketplace-concurrency-scale.test.ts", "The ten-trade Exchange scale rehearsal is not wired into the root package.");
check(rootPackage.scripts?.["mobile:review-surface"] === "node scripts/verify-mobile-review-surface.mjs", "The public App Review preflight is not wired into the root package.");
check(rootPackage.scripts?.["mobile:verify"]?.includes("mobile:store-readiness"), "Mobile verification does not run the store source-readiness gate.");
check(releaseSafetyGate.includes('label: "Full Exchange App Review rehearsal"') && releaseSafetyGate.includes('arguments: ["run", "mobile:review-rehearsal"]'), "The full release gate does not run the named Exchange reviewer rehearsal.");
check(releaseSafetyGate.includes('label: "Ten-trade Exchange scale rehearsal"') && releaseSafetyGate.includes('arguments: ["run", "mobile:scale-rehearsal"]'), "The full release gate does not run the named ten-trade scale rehearsal.");
check(appConfig.name.length <= 30, "The App Store name exceeds 30 characters.");
check(/^\d+\.\d+\.\d+$/.test(appConfig.version), "The Expo version must use strict major.minor.patch format.");
check(mobilePackage.version === appConfig.version, "The Expo and mobile-package versions do not match.");
check(
  versionContract.includes(`MOBILE_CURRENT_APP_VERSION = "${appConfig.version}"`),
  "The shared mobile version contract does not match the Expo version.",
);
check(appConfig.ios?.bundleIdentifier === "com.alphakits.alphatraders", "Unexpected iOS bundle identifier.");
check(appConfig.android?.package === appConfig.ios?.bundleIdentifier, "The iOS and Android application identifiers do not match.");
check(appConfig.scheme === "alphatraders", "The trusted app URL scheme is missing or changed.");
check(appConfig.extra?.eas?.projectId === "e5dbc3ba-25fb-4373-8ded-c8c80cadc147", "Unexpected EAS project ID.");
check(appConfig.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false, "Export-compliance encryption declaration is missing.");
check(appConfig.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false, "iOS arbitrary network loads must be disabled.");
check(appConfig.android?.allowBackup === false, "Android application backup must remain disabled.");
check(appConfig.android?.blockedPermissions?.includes("android.permission.SYSTEM_ALERT_WINDOW"), "The unused Android system-overlay permission must be blocked.");
check(appConfig.android?.blockedPermissions?.includes("android.permission.RECORD_AUDIO"), "The unused Android microphone permission must be blocked explicitly.");
check(hasPlugin(appConfig.plugins, "expo-notifications"), "Native notification configuration is missing.");
check(hasPlugin(appConfig.plugins, "expo-image-picker"), "Trade-evidence image picker configuration is missing.");
const imagePicker = pluginOptions(appConfig.plugins, "expo-image-picker");
check(Boolean(imagePicker?.photosPermission?.includes("active trade")), "The photo permission does not explain its active-trade purpose.");
check(Boolean(imagePicker?.cameraPermission?.includes("active trade")), "The camera permission does not explain its active-trade purpose.");
check(imagePicker?.microphonePermission === false, "The unused microphone permission must remain disabled.");

const iconPath = resolve(repositoryRoot, "apps/mobile", appConfig.icon).replace(`${repositoryRoot}/`, "");
const adaptiveIconPath = resolve(repositoryRoot, "apps/mobile", appConfig.android?.adaptiveIcon?.foregroundImage).replace(`${repositoryRoot}/`, "");
for (const [label, path] of [["primary", iconPath], ["adaptive", adaptiveIconPath]]) {
  const metadata = readPngMetadata(path);
  check(metadata.valid, `The ${label} application icon is not a valid PNG.`);
  check(metadata.width === 1024 && metadata.height === 1024, `The ${label} application icon must be exactly 1024 x 1024 pixels.`);
  check(!metadata.hasAlpha, `The ${label} application icon must be fully opaque.`);
}

check(rootLayout.includes("<WebsiteAppShell"), "The shipping root no longer renders the full website-parity shell.");
check(rootLayout.includes("<NetworkProvider>"), "The shipping root is missing native network awareness.");
check(websiteShell.includes('from "react-native-webview"'), "The website-parity WebView dependency is missing.");
check(websiteShell.includes("isTrustedWebsiteDocumentUrl(event.nativeEvent.url)"), "Native bridge messages are not restricted to the first-party document.");
check(websiteShell.includes('mixedContentMode="never"'), "Mixed-content loading is not disabled.");
check(websiteShell.includes("thirdPartyCookiesEnabled={false}"), "Third-party cookies are not disabled.");
check(websiteShell.includes("allowFileAccess={false}"), "WebView file access is not disabled.");
check(!websiteShell.includes('"https://*"'), "The WebView origin allowlist is too broad.");
check(!websiteShell.includes('"data:*"'), "Data-document navigation must not be allowlisted.");
check(websiteShell.includes("registerForNativePushNotifications"), "Native lock-screen push registration is missing.");
check(websiteShell.includes("sourcePreparationInFlightRef") && websiteShell.includes("resolvePreparedWebsiteSource"), "Cold-start push navigation is not protected from asynchronous source-preparation races.");
check(pushNavigationRecovery.includes("pendingPushUrlAfterConsumption"), "One-time push destination consumption is missing.");
check(websiteShell.includes("requestAppReviewAfterCompletedTrade"), "The verified post-trade native review prompt is missing.");
check(websiteShell.includes('readiness.status === "update_required"'), "Mandatory-update handling is missing from the shipping shell.");
check(websiteShell.includes('setIsPrivacyMasked(state !== "active")'), "The native app-switcher privacy mask is missing.");
check(websiteShell.includes("styles.privacyMask"), "The inactive-app privacy surface is not rendered by the shipping shell.");
check(navigation.includes('ALPHA_TRADERS_WEB_ORIGIN = "https://www.alphatraders.co.il"'), "The canonical production origin changed unexpectedly.");
check(navigation.includes("isTrustedWebsiteBlobUrl"), "First-party blob navigation validation is missing.");

check(Boolean(easConfig.build?.preview), "The EAS preview build profile is missing.");
check(easConfig.build?.production?.autoIncrement === true, "Production build-number auto-increment is missing.");
check(Boolean(easConfig.submit?.production), "The EAS production submission profile is missing.");
check(installedIphoneWorkflow.includes("type: apple-device-registration-request"), "The registered-iPhone workflow is missing device registration.");
check(installedIphoneWorkflow.includes("refresh_ad_hoc_provisioning_profile: true"), "The registered-iPhone workflow does not refresh provisioning.");
check(iosTestflightWorkflow.includes("branches: [release/ios-testflight]"), "The TestFlight workflow is not isolated to its controlled release branch.");
check(iosTestflightWorkflow.includes("profile: production"), "The TestFlight workflow is not using the production profile.");
check(iosTestflightWorkflow.includes("type: testflight"), "The TestFlight upload job is missing.");
check(iosTestflightWorkflow.includes("needs: [build_ios]"), "The TestFlight upload is not gated on a successful iOS build.");
check(iosTestflightWorkflow.includes("build_id: ${{ needs.build_ios.outputs.build_id }}"), "The TestFlight upload is not pinned to the build produced by the workflow.");
check(iosTestflightWorkflow.includes("submit_beta_review: false"), "The private TestFlight workflow must not request external Beta App Review.");
check(!iosTestflightWorkflow.includes("external_groups:"), "The private TestFlight workflow must not distribute to external groups.");
check(githubWorkflow.includes("eas build --platform ios --profile preview"), "The GitHub iOS preview workflow is missing.");

check(storeMetadata.primaryCategory === "FINANCE", "The primary store category must reflect the app's financial marketplace.");
check(storeMetadata.secondaryCategory === "EDUCATION", "The secondary store category must reflect the Academy.");
for (const locale of ["en-US", "ar-SA"]) {
  const metadata = storeMetadata.localizations?.[locale];
  check(Boolean(metadata), `Store metadata is missing for ${locale}.`);
  if (!metadata) continue;
  check([...metadata.name].length <= 30, `${locale} App Store name exceeds 30 characters.`);
  check([...metadata.subtitle].length <= 30, `${locale} App Store subtitle exceeds 30 characters.`);
  check([...metadata.promotionalText].length <= 170, `${locale} promotional text exceeds 170 characters.`);
  check([...metadata.description].length <= 4000, `${locale} description exceeds 4,000 characters.`);
  check([...metadata.keywords].length <= 100, `${locale} keywords exceed 100 characters.`);
  for (const field of ["marketingUrl", "supportUrl", "privacyPolicyUrl"]) {
    check(metadata[field]?.startsWith("https://www.alphatraders.co.il/"), `${locale} ${field} must use the production HTTPS origin.`);
  }
  check(metadata.description.includes("USDT"), `${locale} description must disclose the USDT marketplace.`);
  check(metadata.whatsNew.includes("USDT"), `${locale} What's New text must disclose the full USDT experience.`);
}

const googlePlayMetadata = storeMetadata.googlePlay;
check(googlePlayMetadata?.category === "FINANCE", "The Google Play category must reflect the app's financial marketplace.");
check(googlePlayMetadata?.supportEmail === "support@alphatraders.co.il", "The Google Play support email is missing or unexpected.");
for (const field of ["websiteUrl", "privacyPolicyUrl", "accountDeletionUrl"]) {
  check(googlePlayMetadata?.[field]?.startsWith("https://www.alphatraders.co.il/"), `Google Play ${field} must use the production HTTPS origin.`);
}
for (const locale of ["en-US", "ar"]) {
  const metadata = googlePlayMetadata?.localizations?.[locale];
  check(Boolean(metadata), `Google Play metadata is missing for ${locale}.`);
  if (!metadata) continue;
  check([...metadata.title].length <= 30, `Google Play ${locale} title exceeds 30 characters.`);
  check([...metadata.shortDescription].length <= 80, `Google Play ${locale} short description exceeds 80 characters.`);
  check([...metadata.fullDescription].length <= 4_000, `Google Play ${locale} full description exceeds 4,000 characters.`);
  check([...metadata.releaseNotes].length <= 500, `Google Play ${locale} release notes exceed 500 characters.`);
  check(metadata.fullDescription.includes("USDT"), `Google Play ${locale} full description must disclose the USDT marketplace.`);
  check(metadata.releaseNotes.includes("USDT"), `Google Play ${locale} release notes must disclose the full USDT experience.`);
  check(!metadata.fullDescription.includes("iPhone"), `Google Play ${locale} copy must not describe the Android build as an iPhone app.`);
}

check(userSafetyActions.includes("Block user"), "The user-facing block control is missing.");
check(userSafetyActions.includes("Report user"), "The user-facing report control is missing.");
check(userBlockRoute.includes("setUserBlockStatus"), "The authenticated user-block route is missing.");
check(exchangeStore.includes('"USER_INTERACTION_BLOCKED"'), "A user block does not prevent future trades.");
check(exchangeStore.includes("interactionBlockedSellerIds"), "Blocked users' listings are not filtered from the marketplace.");
check(tradeRoomPage.includes("acquireTradeRoomMutation(actionInFlightRef, mutationKey)"), "Competing Trade Room lifecycle actions are not synchronously serialized.");
check(tradeRoomActions.includes("releaseTradeRoomMutation") && tradeRoomActions.includes("lock.current === mutationKey"), "Trade Room mutation locks are not owner-safe on release.");

for (const route of ["privacy-policy", "support", "account-deletion", "report-abuse"]) {
  check(
    readText(`src/app/[locale]/${route}/page.tsx`).length > 0,
    `The required public ${route} route is missing.`,
  );
}
check(supportPage.includes('href={`mailto:${BRAND_SUPPORT_EMAIL}'), "The support page is missing its one-tap support email action.");
check(supportPage.includes("<ContactForm"), "The support page is missing its direct in-app support form.");
check(reviewSurfaceScript.includes('const productionOrigin = "https://www.alphatraders.co.il"'), "The public review preflight is not pinned to the canonical production origin by default.");
check(reviewSurfaceScript.includes('path = "/api/health"'), "The public review preflight does not verify service/database health.");
check(reviewSurfaceScript.includes('path = "/api/mobile/v1/app-config"'), "The public review preflight does not verify the native app contract.");
check(reviewSurfaceScript.includes('path: "/en/support"') && reviewSurfaceScript.includes('path: "/ar/support"'), "The public review preflight does not verify bilingual support.");
check(reviewRehearsal.includes('vi.mock("@/lib/postgres-runtime"') && reviewRehearsal.includes("getRuntimePostgresPool: () => null"), "The reviewer rehearsal is not isolated from the production database.");
check(reviewRehearsal.includes("@example.test") && reviewRehearsal.includes("email: false, sms: false"), "The reviewer rehearsal must use non-deliverable fictional identities and disable outbound notification channels.");
for (const capability of [
  "createMarketplaceListing",
  "createPurchaseRequest",
  "getTradeRoomBankDetails",
  "postTradeRoomMessage",
  "uploadTradeEvidence",
  "submitBuyerTradeReview",
  "setUserBlockStatus",
  "reportSeller",
  "openTradeDispute",
]) {
  check(reviewRehearsal.includes(capability), `The reviewer rehearsal does not exercise ${capability}.`);
}
check(scaleRehearsal.includes('vi.mock("@/lib/postgres-runtime"') && scaleRehearsal.includes("getRuntimePostgresPool: () => null"), "The scale rehearsal is not isolated from the production database.");
check(scaleRehearsal.includes("Array.from({ length: 10 }") && scaleRehearsal.includes("simultaneous complete trade lifecycles"), "The scale rehearsal does not cover ten complete concurrent Exchange journeys.");
for (const capability of [
  "postTradeRoomMessage",
  "uploadTradeEvidence",
  "getCommissionRecordsForAdmin",
  "submitBuyerTradeReview",
  "submitSellerReviewResponse",
]) {
  check(scaleRehearsal.includes(capability), `The ten-trade scale rehearsal does not exercise ${capability}.`);
}
check(scaleRehearsal.includes("@example.test") && scaleRehearsal.includes("email: false, sms: false"), "The scale rehearsal must use non-deliverable fictional identities and disable outbound notification channels.");
check(submissionPack.includes("## App Review notes"), "The App Review notes are missing from the submission pack.");
check(submissionPack.includes("## Reviewed feature consistency"), "The full-Exchange review consistency rule is missing.");
check(submissionPack.includes("## App Privacy declaration worksheet"), "The App Privacy worksheet is missing from the submission pack.");
check(submissionPack.includes("## Licensing and territory gate"), "The licensing and territory gate is missing from the submission pack.");
check(submissionPack.includes("## Screenshot capture plan"), "The screenshot plan is missing from the submission pack.");
check(submissionPack.includes(`| Version | \`${appConfig.version}\` |`), "The App Store Connect submission-pack version does not match the Expo version.");
check(googlePlaySubmissionPack.includes("## Reviewed feature consistency"), "The Google Play full-Exchange consistency rule is missing.");
check(googlePlaySubmissionPack.includes("## Play review access"), "The Google Play review-access plan is missing.");
check(googlePlaySubmissionPack.includes("## Data safety declaration worksheet"), "The Google Play Data safety worksheet is missing.");
check(googlePlaySubmissionPack.includes("## Financial features and territory gate"), "The Google Play financial-features gate is missing.");
check(googlePlaySubmissionPack.includes("## Store listing and graphics"), "The Google Play listing and graphics plan is missing.");
check(googlePlaySubmissionPack.includes("## Final submission sequence"), "The Google Play submission sequence is missing.");
check(googlePlaySubmissionPack.includes(`| Version | \`${appConfig.version}\` |`), "The Google Play submission-pack version does not match the Expo version.");
for (const officialSource of [
  "https://support.google.com/googleplay/android-developer/answer/13393723",
  "https://support.google.com/googleplay/android-developer/answer/10787469",
  "https://support.google.com/googleplay/android-developer/answer/13849271",
  "https://support.google.com/googleplay/android-developer/answer/16329703",
  "https://support.google.com/googleplay/android-developer/answer/15748846",
]) {
  check(googlePlaySubmissionPack.includes(officialSource), `The Google Play submission pack is missing official source ${officialSource}.`);
}
check(fullExchangeEvidence.includes("## Non-negotiable release invariant"), "The full-Exchange release invariant is missing.");
check(fullExchangeEvidence.includes("Guideline 3.1.5(iii)"), "The cryptocurrency-exchange evidence gate is missing.");
check(fullExchangeEvidence.includes("Guideline 4.2"), "The native minimum-functionality evidence is missing.");
check(fullExchangeEvidence.includes("Legal entity providing the regulated service"), "The submitting legal-entity evidence gate is missing.");
check(fullExchangeEvidence.includes("Fictional App Review scenario"), "The safe reviewer scenario is missing.");
check(fullExchangeEvidence.includes("Established operating-history evidence"), "The established Exchange operating-history evidence plan is missing.");
check(fullExchangeEvidence.includes("WhatsApp member list") && fullExchangeEvidence.includes("seller identity document"), "The seller/community identity-evidence privacy rule is missing.");
check(responsePlaybook.includes("## Response rules"), "The App Review response rules are missing.");
check(responsePlaybook.includes("## Question-and-evidence matrix"), "The App Review question-and-evidence matrix is missing.");
check(responsePlaybook.includes("## Stop and escalate"), "The App Review legal escalation boundary is missing.");
check(responsePlaybook.includes("## Response templates"), "The App Review response templates are missing.");
check(responsePlaybook.includes("government-issued identity documents") && responsePlaybook.includes("secure channel"), "The enrollment identity-spelling response is missing.");
check(responsePlaybook.includes("citizenship or residence alone is not authorization"), "The identity and territory-authorization boundary is missing.");
check(responsePlaybook.includes("Do not upload seller identity documents") && responsePlaybook.includes("Do not improvise a legal conclusion"), "The App Review response playbook is missing its evidence-safety stop rules.");
check(responsePlaybook.includes("https://developer.apple.com/app-store/review/guidelines/") && responsePlaybook.includes("manage-app-privacy") && responsePlaybook.includes("CELEX:32023R1114"), "The App Review response playbook is missing its official Apple/EU sources.");
check(privateRecordTemplate.includes("## Release identity") && privateRecordTemplate.includes("## Gate register"), "The private App Review release-record template is incomplete.");
check(privateRecordTemplate.includes("Exact legal name from selected government ID") && privateRecordTemplate.includes("Identity-document and legal-name consistency reconciled"), "The private release record is missing identity reconciliation.");
check(privateRecordTemplate.includes("## Apple correspondence log") && privateRecordTemplate.includes("## Attachment release check"), "The private App Review case and attachment controls are missing.");
check(privateRecordTemplate.includes("Never populate this repository"), "The private release-record template does not prohibit committing sensitive evidence.");
check(economicCalendarPlan.includes("Do not scrape Forex Factory"), "The economic-calendar data rights rule is missing.");
check(economicCalendarPlan.includes("not part of the first release"), "The economic-calendar release boundary is missing.");
check(economicCalendarPlan.toLowerCase().includes("market-event notifications are optional"), "The economic-calendar notification consent rule is missing.");
check(runbook.toLowerCase().includes("real-device acceptance matrix"), "The signed-device acceptance matrix is missing.");
check(runbook.includes("docs/mobile/google-play-submission-pack.md"), "The private-beta runbook does not route Android public releases through the Google Play submission pack.");
check(reviewDryRun.includes("## Exact reviewer journey"), "The exact signed-device App Review journey is missing.");
check(reviewDryRun.includes("## Pass-or-block decision"), "The App Review dry-run stop rule is missing.");
check(reviewDryRun.includes("must not reopen either notification"), "The signed-device dry run is missing stale push-navigation recovery.");
check(reviewDryRun.includes("rapidly press two competing lifecycle controls"), "The signed-device dry run is missing rapid competing-action protection.");
check(reviewDryRun.includes("## Automated rehearsal boundary"), "The local reviewer-rehearsal boundary is not documented.");
check(reviewDryRun.includes("/api/admin/setup-test-accounts") && reviewDryRun.includes("/api/testing"), "The reviewer-account guide does not prohibit production test/setup routes.");

if (failures.length > 0) {
  console.error(`\nMobile store source readiness failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nMobile store source readiness passed (${passed} checks).`);

const appleSubmissionConfirmations = [
  ["ALPHA_APPLE_MEMBERSHIP_ACTIVE", "Apple Developer Program enrollment is active"],
  ["ALPHA_APPLE_FULL_EXCHANGE_SCOPE_APPROVED", "the exact reviewed build, metadata, screenshots, and notes disclose the complete Exchange"],
  ["ALPHA_APPLE_LEGAL_ENTITY_APPROVED", "the submitting Apple team and legal entity are eligible for the regulated service"],
  ["ALPHA_APPLE_LEGAL_EVIDENCE_APPROVED", "counsel-approved licensing and storefront evidence is attached"],
  ["ALPHA_APPLE_OPERATIONAL_EVIDENCE_READY", "claims about established operations and seller vetting are supported by private redacted evidence"],
  ["ALPHA_APPLE_PUBLIC_PREFLIGHT_APPROVED", "the deployed production health, native version contract, and bilingual public review routes passed"],
  ["ALPHA_APPLE_REVIEW_ACCOUNT_READY", "fictional buyer and seller reviewer accounts are live"],
  ["ALPHA_APPLE_SIGNED_BUILD_READY", "the exact release commit has a signed TestFlight build"],
  ["ALPHA_APPLE_DEVICE_MATRIX_APPROVED", "the bilingual real-device matrix passed"],
  ["ALPHA_APPLE_STORE_METADATA_ENTERED", "metadata, privacy answers, screenshots, and review notes were entered"],
  ["ALPHA_APPLE_RESPONSE_PLAYBOOK_READY", "the response owner, evidence owners, private case record, and escalation contacts are ready"],
];
const googlePlaySubmissionConfirmations = [
  ["ALPHA_GOOGLE_PLAY_ACCOUNT_READY", "the verified Play Console developer account, agreements, and app record are active"],
  ["ALPHA_GOOGLE_PLAY_FULL_EXCHANGE_SCOPE_APPROVED", "the exact Android build, listing, graphics, and review instructions disclose the complete Exchange"],
  ["ALPHA_GOOGLE_PLAY_LEGAL_ENTITY_APPROVED", "the Play Console developer identity and legal entity are eligible for the offered financial service"],
  ["ALPHA_GOOGLE_PLAY_LEGAL_EVIDENCE_APPROVED", "counsel-approved licensing and country/storefront evidence is ready for the exact marketplace model"],
  ["ALPHA_GOOGLE_PLAY_PUBLIC_PREFLIGHT_APPROVED", "the deployed production health, native version contract, and bilingual public review routes passed"],
  ["ALPHA_GOOGLE_PLAY_REVIEW_ACCOUNT_READY", "reusable fictional buyer and seller review accounts and English access instructions are live"],
  ["ALPHA_GOOGLE_PLAY_SIGNED_BUILD_READY", "the exact release commit has a signed Android App Bundle on the intended Play testing track"],
  ["ALPHA_GOOGLE_PLAY_DEVICE_MATRIX_APPROVED", "the bilingual Android real-device matrix and Play pre-launch report passed"],
  ["ALPHA_GOOGLE_PLAY_STORE_METADATA_ENTERED", "localized listing copy, release notes, screenshots, graphics, support, privacy, and deletion URLs were entered"],
  ["ALPHA_GOOGLE_PLAY_DATA_SAFETY_APPROVED", "the Data safety form was reconciled with app behavior, SDKs, providers, privacy policy, and deletion flow"],
  ["ALPHA_GOOGLE_PLAY_FINANCIAL_DECLARATION_APPROVED", "the Financial features declaration and cryptocurrency-policy evidence were completed accurately"],
  ["ALPHA_GOOGLE_PLAY_ROLLOUT_READY", "testers, release countries, managed publishing, monitoring owner, and staged-rollout stop conditions are approved"],
];
const submissionConfirmations = submissionPlatform === "ios"
  ? appleSubmissionConfirmations
  : submissionPlatform === "android"
    ? googlePlaySubmissionConfirmations
    : [...appleSubmissionConfirmations, ...googlePlaySubmissionConfirmations];
const missingConfirmations = submissionConfirmations.filter(([name]) => process.env[name] !== "1");

if (!submissionMode) {
  console.log("Manual submission gates remain separate. Run the combined, iOS, or Android submission command only after the release owner confirms its external gates.\n");
  process.exit(0);
}

if (missingConfirmations.length > 0) {
  console.error(`\nPublic ${submissionPlatform === "ios" ? "iOS" : submissionPlatform === "android" ? "Android" : "iOS/Android"} submission is blocked until these confirmations are set to 1 for the release session:\n`);
  for (const [name, description] of missingConfirmations) console.error(`- ${name}: ${description}`);
  process.exit(1);
}

console.log(`All ${submissionPlatform} release-owner submission confirmations are present. Continue only with the exact signed and tested commit.\n`);
