import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
import wordlists
from dictionary import Engine


class WordListAudioTests(unittest.TestCase):
    def test_audio_links_and_service_fingerprint(self):
        html='''<ul><li data-hw="phrase" data-opal_written_phrases="examples"><a class="pron-uk" href="sound://SAME.mp3"></a><a class="pron-us" href="sound://same.mp3"></a><a class="pron-uk" href="sound://folder/../invalid.mp3"></a><a class="pron-uk" href="sound://image.png"></a></li></ul>'''
        rows=wordlists.parse(html)
        self.assertEqual(rows[0]['audio'],{'UK':['same.mp3'],'US':['same.mp3']})
        descriptor=wordlists.describe(['@opal_written&level=sublist_1'],wordlists.opal_fields(rows))[0]
        engine=object.__new__(Engine)
        engine.oxford_source_sha='a'*64
        engine.word_list_catalog=lambda:[descriptor]
        engine._word_list_rows=lambda key:rows
        result=engine.word_list(descriptor['id'])
        self.assertEqual(result['sourceSha256'],'a'*64)
        self.assertEqual(result['rows'][0]['audio'],rows[0]['audio'])


if __name__=='__main__':unittest.main()
