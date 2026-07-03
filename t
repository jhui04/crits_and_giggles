diff --git a/test-results/.last-run.json b/test-results/.last-run.json
index d66b652..cbcc1fb 100644
--- a/test-results/.last-run.json
+++ b/test-results/.last-run.json
@@ -1,6 +1,4 @@
 {
-  "status": "failed",
-  "failedTests": [
-    "4c10708ad6d8d45ae5ba-06c990981f6e2d53dba4"
-  ]
+  "status": "passed",
+  "failedTests": []
 }
\ No newline at end of file
diff --git a/tests/oracle-accessibility.spec.ts b/tests/oracle-accessibility.spec.ts
index 11df261..316a48f 100644
--- a/tests/oracle-accessibility.spec.ts
+++ b/tests/oracle-accessibility.spec.ts
@@ -80,7 +80,8 @@ test.describe('Oracle Accessibility', () => {
     
     // Switch back to Monsters
     await page.selectOption('#oracle-type-filter', 'monster');
+    const monsterResults = oracle.locator('ul li button');
     await page.locator('#monster-search').fill('Aboleth');
-    await expect(page.locator('text=Aboleth')).toBeVisible();
+    await expect(monsterResults.first()).toContainText('Aboleth');
   });
 });
