#!/usr/bin/env groovy
/**
 * Lightweight Groovy smoke test that validates the Weather Dashboard App landing page helpers
 * without requiring the full Hubitat runtime. The script stubs Hub-specific DSL functions and
 * focuses on verifying the Maker API credentials flow that powers the embedded preview.
 */

import groovy.json.JsonOutput

Binding binding = new Binding()
binding.setVariable('definition', { Map config -> config })
binding.setVariable('preferences', { Closure<?> handler -> })
binding.setVariable('mappings', { Closure<?> handler -> })

def shell = new GroovyShell(binding)
File appFile = new File('hubitat/WeatherDashboardApp.groovy')
if (!appFile.exists()) {
    throw new FileNotFoundException("Unable to locate ${appFile} from repo root. Run this script from the project root directory.")
}
Script appScript = shell.parse(appFile)
appScript.binding.setVariable('settings', [:])
appScript.binding.setVariable('app', [id: 101] as Expando)
appScript.run()

Object invokePrivate(Script script, String methodName, Class<?>[] parameterTypes = [] as Class<?>[], Object... args) {
    def method = script.class.getDeclaredMethod(methodName, parameterTypes)
    method.accessible = true
    return method.invoke(script, args)
}

// Scenario: fully populated Maker API configuration renders an embeddable URL with encoded parameters.
appScript.binding.setVariable('settings', [
    makerApiBaseUrl : 'http://192.168.1.50',
    makerApiToken   : 's3cr3tTOKEN',
    makerApiDeviceIds: '10, 11,12\n13'
])
String embedUrl = invokePrivate(appScript, 'buildDashboardEmbedUrl') as String
assert embedUrl?.startsWith('/local/weather-dashboard-app.html?')
assert embedUrl.contains('hubBaseUrl=http%3A%2F%2F192.168.1.50')
assert embedUrl.contains('appId=101')
assert embedUrl.contains('makerToken=s3cr3tTOKEN')
assert embedUrl.contains('deviceIds=10%2C11%2C12%2C13')
assert embedUrl.contains('devices=10%2C11%2C12%2C13')

// Scenario: HTML attribute encoding prevents iframe injection issues.
String encoded = invokePrivate(appScript, 'htmlAttributeEncode', [String] as Class<?>[], '"foo&bar<baz>') as String
assert encoded == '&quot;foo&amp;bar&lt;baz&gt;'

// Scenario: missing configuration disables the preview instead of emitting a malformed URL.
appScript.binding.setVariable('settings', [makerApiBaseUrl: null, makerApiToken: 'abc'])
assert invokePrivate(appScript, 'buildDashboardEmbedUrl') == null

println JsonOutput.toJson([status: 'ok', message: 'Weather Dashboard landing helpers verified'])
