import unittest

from check_auth_redirect import evaluate_response


class AuthFallbackTests(unittest.TestCase):
    def response(self, location, code=303, curl_exit=0):
        return evaluate_response(curl_exit, code,
                                 f'HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 {code}\r\nLocation: {location}\r\n')

    def test_current_production_destination(self):
        self.assertEqual(self.response('https://www.alphatraders.co.il/#error=otp_expired')['status'], 'PASS')

    def test_original_localhost_defect(self):
        self.assertEqual(self.response('http://localhost:3000/#error=otp_expired')['status'], 'FAIL')

    def test_unexpected_origin_port_and_userinfo(self):
        for value in ['http://www.alphatraders.co.il', 'https://www.alphatraders.co.il.evil.example',
                      'https://www.alphatraders.co.il:444', 'https://user@www.alphatraders.co.il',
                      '/en/login', 'https://www.alphatraders.co.il/unexpected']:
            with self.subTest(value=value):
                self.assertEqual(self.response(value)['status'], 'FAIL')

    def test_partial_response_cannot_pass(self):
        self.assertEqual(self.response('https://www.alphatraders.co.il', curl_exit=28)['status'], 'VERIFICATION_LIMITED')

    def test_provider_outage_or_rate_limit_is_not_a_redirect_diagnosis(self):
        for status in [429, 500, 503]:
            with self.subTest(status=status):
                self.assertEqual(self.response('', code=status)['status'], 'VERIFICATION_LIMITED')

    def test_no_redirect_fails(self):
        self.assertEqual(self.response('', code=200)['status'], 'FAIL')

    def test_header_status_mismatch_is_inconclusive(self):
        self.assertEqual(evaluate_response(0, 303, 'HTTP/1.1 200 Connection established')['status'], 'VERIFICATION_LIMITED')

    def test_evidence_does_not_retain_redirect_secrets(self):
        result = self.response('https://www.alphatraders.co.il/?token=private#access_token=secret')
        self.assertNotIn('private', str(result))
        self.assertNotIn('secret', str(result))


if __name__ == '__main__':
    unittest.main()
