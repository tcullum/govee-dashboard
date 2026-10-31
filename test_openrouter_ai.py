"""Offline OpenRouter transport and dashboard integration regression tests."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

class OpenRouterTests(unittest.TestCase):
    def test_fixed_endpoint_and_bounded_plain_text_completion(self):
        import openrouter_ai as ai
        reply = Mock(status_code=200)
        reply.json.return_value = {'choices':[{'finish_reason':'stop','message':{'content':'Forecast answer'}}]}
        with patch.dict(os.environ, {'OPENROUTER_API_KEY':'test-only-key','OPENROUTER_MODEL':'anthropic/claude-haiku-4.5'}), patch.object(ai.requests,'post',return_value=reply) as post:
            self.assertEqual(ai.complete('Weather context','Weather question',800), 'Forecast answer')
        args = post.call_args
        self.assertEqual(args.args[0], 'https://openrouter.ai/api/v1/chat/completions')
        self.assertEqual(args.kwargs['headers']['Authorization'], 'Bearer test-only-key')
        self.assertEqual(args.kwargs['json']['model'], 'anthropic/claude-haiku-4.5')
        self.assertEqual(args.kwargs['json']['max_tokens'],800)
        self.assertFalse(args.kwargs['json']['stream'])
        self.assertFalse(args.kwargs['allow_redirects'])
        self.assertEqual(args.kwargs['timeout'],(5,40))
        self.assertNotIn('tools',args.kwargs['json'])
        self.assertEqual(post.call_count,1)

    def test_secret_file_is_read_without_exposing_contents(self):
        import openrouter_ai as ai
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'key.env'
            for content in ('test-only-key\n', 'OPENROUTER_API_KEY="test-only-key"\n'):
                p.write_text(content)
                with patch.dict(os.environ, {'OPENROUTER_API_KEY':'','OPENROUTER_API_KEY_FILE':str(p)}):
                    self.assertEqual(ai.api_key(),'test-only-key')

    def test_errors_redirects_and_incomplete_responses_are_safe(self):
        import openrouter_ai as ai
        with patch.dict(os.environ, {'OPENROUTER_API_KEY':'test-only-key'}):
            for status in (301,400,401,402,403,429,500):
                r=Mock(status_code=status,text='SECRET-MUST-NOT-LEAK')
                with self.subTest(status=status), patch.object(ai.requests,'post',return_value=r), self.assertRaises(ai.AIError) as caught:
                    ai.complete('context','question',800)
                self.assertNotIn('SECRET',str(caught.exception))
            for choices in ([],[{'finish_reason':'length','message':{'content':'partial'}}], [{'finish_reason':'stop','message':{'content':'','tool_calls':[{}]}}]):
                r=Mock(status_code=200)
                r.json.return_value={'choices':choices}
                with patch.object(ai.requests,'post',return_value=r),self.assertRaises(ai.AIError):
                    ai.complete('context','question',800)

    def test_weather_endpoint_uses_openrouter_and_keeps_origin_check(self):
        import govee_server, openrouter_ai as ai
        from test_weather_questions import WeatherQuestionTests
        upstream,_=WeatherQuestionTests().upstream_fixtures()
        govee_server.app.extensions['weather_questions']['attempts'].clear()
        with patch.dict(os.environ,{'AI_PROVIDER':'openrouter','OPENROUTER_API_KEY':'test-only-key'}),patch('requests.get',return_value=upstream),patch.object(ai,'complete',return_value='Fresh forecast answer') as call:
            client=govee_server.app.test_client()
            payload={'question':'Rain?','latitude':36.17,'longitude':-115.14,'unit':'F','location':'Las Vegas'}
            self.assertEqual(client.post('/api/weather/ask',json=payload,headers={'Origin':'https://evil.example'}).status_code,403)
            call.assert_not_called()
            result=client.post('/api/weather/ask',json=payload)
            self.assertEqual(result.status_code,200,result.json)
            self.assertEqual(result.json['answer'],'Fresh forecast answer')
            call.assert_called_once()

    def test_insights_use_openrouter_and_cache_fresh_output(self):
        import govee_server as server, openrouter_ai as ai
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'AI_PROVIDER':'openrouter','OPENROUTER_API_KEY':'test-only-key'}), \
                patch.object(server,'INSIGHTS_CACHE_FILE',str(Path(tmp)/'insights.json')), \
                patch.object(server,'api_almanac') as almanac, patch.object(server,'api_readings') as readings, \
                patch('requests.get') as get, patch('anthropic.Anthropic',side_effect=RuntimeError('Direct Anthropic must not be used')), \
                patch.object(ai,'complete',return_value='["Forecast insight"]') as complete:
            almanac.return_value.get_json.return_value={'avg_high':85,'avg_low':60,'history':[]}
            readings.return_value.get_json.return_value={'items':[]}
            get.return_value.json.return_value={'current':{'temperature_2m':80},'daily':{'temperature_2m_max':[90],'temperature_2m_min':[60]}}
            response=server.app.test_client().get('/api/almanac/insights')
            self.assertEqual(response.status_code,200,response.json)
            self.assertEqual(response.json['insights'],['Forecast insight'])
            complete.assert_called_once()
            self.assertTrue((Path(tmp)/'insights.json').is_file())

if __name__=='__main__': unittest.main()
