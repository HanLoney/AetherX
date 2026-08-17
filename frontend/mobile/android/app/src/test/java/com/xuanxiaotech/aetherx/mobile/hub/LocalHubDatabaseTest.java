package com.xuanxiaotech.aetherx.mobile.hub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;


public class LocalHubDatabaseTest {
    @Test
    public void quoteJsonStringMatchesJavaScriptJsonStringify() {
        assertEquals("\"https://hub.example/api/v1\"",
            LocalHubDatabase.quoteJsonString("https://hub.example/api/v1"));
        assertEquals("\"quote\\\" slash/ backslash\\\\ line\\n tab\\t\"",
            LocalHubDatabase.quoteJsonString("quote\" slash/ backslash\\ line\n tab\t"));
        assertEquals("\"\\u0000\\b\\f\\n\\r\\t\\u001f\"",
            LocalHubDatabase.quoteJsonString("\u0000\b\f\n\r\t\u001f"));
        assertEquals("\"emoji 😺\"", LocalHubDatabase.quoteJsonString("emoji 😺"));
        assertEquals("\"\\ud800\"", LocalHubDatabase.quoteJsonString("\ud800"));
        assertEquals("\"\\udc00\"", LocalHubDatabase.quoteJsonString("\udc00"));
    }

    @Test
    public void localHubRecoveryIncludesInterruptedBootstrap() {
        assertFalse(LocalHubService.requiresRecovery(false, "unpaired", "", false));
        assertFalse(LocalHubService.requiresRecovery(true, "stable", "completed", false));
        assertTrue(LocalHubService.requiresRecovery(true, "stable", "", false));
        assertTrue(LocalHubService.requiresRecovery(true, "stable", "restored", false));
        assertTrue(LocalHubService.requiresRecovery(true, "stable", "completed", true));
        assertFalse(LocalHubService.requiresRecovery(true, "integrity_check", "completed", false));
        assertFalse(LocalHubService.requiresRecovery(true, "committing_switch", "completed", false));
        assertTrue(LocalHubService.requiresRecovery(true, "integrity_check", "completed", true));
    }

}
