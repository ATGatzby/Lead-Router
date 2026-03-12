/**
 * HTTP mock used in Apex tests to intercept callouts to the routing engine.
 * Returns a 200 OK response so tests do not fail on missing HTTP connections.
 */
@isTest
global class RoutingEngineMock implements HttpCalloutMock {

    private Integer statusCode;
    private String responseBody;

    // Captured from last request for test assertions
    global String lastEndpoint { get; private set; }
    global String lastBody { get; private set; }

    global RoutingEngineMock() {
        this.statusCode = 202;
        this.responseBody = '{"accepted":1,"duplicates":0}';
    }

    global RoutingEngineMock(Integer statusCode, String responseBody) {
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }

    global HTTPResponse respond(HTTPRequest req) {
        lastEndpoint = req.getEndpoint();
        lastBody = req.getBody();

        HttpResponse res = new HttpResponse();
        res.setStatusCode(this.statusCode);
        res.setHeader('Content-Type', 'application/json');
        res.setBody(this.responseBody);
        return res;
    }
}
