package com.xuanxiaotech.aetherx.mobile.hub;

import static org.junit.Assert.assertEquals;

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
}
