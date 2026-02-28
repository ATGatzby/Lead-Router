/**
 * HTTP mock used in Apex tests to intercept callouts to the routing engine.
 * Returns a 200 OK response so tests do not fail on missing HTTP connections.
 */
@isTest
global class RoutingEngineMock implements HttpCalloutMock {

    private Integer statusCode;
    private String responseBody;

    global RoutingEngineMock() {
        this.statusCode = 200;
        this.responseBody = '{"ok":true}';
    }

    global RoutingEngineMock(Integer statusCode, String responseBody) {
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }

    global HTTPResponse respond(HTTPRequest req) {
        HttpResponse res = new HttpResponse();
        res.setStatusCode(this.statusCode);
        res.setHeader('Content-Type', 'application/json');
        res.setBody(this.responseBody);
        return res;
    }
}
