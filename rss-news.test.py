import unittest,importlib.util,datetime,io
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('rssnews','rss-news.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class FeedTest(unittest.TestCase):
 def test_dates_duplicate_html_and_invalid_xml(self):
  xml=b'''<rss><channel><item><title>Headline</title><description>&lt;script&gt;bad&lt;/script&gt;&lt;p&gt;Text&lt;/p&gt;</description><link>https://t.me/a/1</link><pubDate>Tue, 20 Oct 2026 00:00:00 GMT</pubDate></item><item><title>Duplicate</title><link>https://t.me/a/1</link><pubDate>Tue, 20 Oct 2026 00:00:00 GMT</pubDate></item><item><link>https://t.me/a/2</link><pubDate>Sun, 18 Oct 2026 00:00:00 GMT</pubDate></item><item><link>https://t.me/a/3</link><pubDate>Wed, 21 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>'''
  with patch.object(m.urllib.request,'urlopen',return_value=io.BytesIO(xml)):
   r=m.fetch('http://example.test',datetime.datetime(2026,10,20,1,tzinfo=datetime.timezone.utc),8)
  self.assertEqual(len(r),1);self.assertEqual(r[0]['summary'],'Text')
  with patch.object(m.urllib.request,'urlopen',return_value=io.BytesIO(b'<!DOCTYPE rss><rss/>')):
   with self.assertRaises(ValueError):m.fetch('http://example.test',datetime.datetime.now(datetime.timezone.utc),8)
if __name__=='__main__':unittest.main()
