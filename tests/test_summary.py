"""Regression for previews accidentally choosing a subject label as the meaning."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from dictionary import rich_blocks
from oxford_summary import oxford_summary


class SummaryTest(unittest.TestCase):
    def test_definitions_precede_labels_and_examples_without_removing_source_text(self):
        html = ('<div><span class="labels"><chn>测试领域</chn></span>'
                '<deft><chn>第一义项</chn></deft><xt><chn>这里是完整例句。</chn></xt>'
                '<deft><chn>第二义项</chn></deft><deft><chn>第一义项</chn></deft></div>')
        blocks, _, info = rich_blocks(html, with_info=True)
        self.assertEqual(info['brief'], '第一义项 / 第二义项')
        self.assertEqual(oxford_summary(html), info['brief'])
        self.assertIn('测试领域', str(blocks))
        self.assertIn('这里是完整例句', str(blocks))
        self.assertEqual(oxford_summary('<script><chn>脚本内容</chn></script><chn>兼容旧格式</chn>'), '兼容旧格式')
        self.assertEqual(len(oxford_summary('<deft><chn>' + '🙂' * 241 + '</chn></deft>')), 240)
