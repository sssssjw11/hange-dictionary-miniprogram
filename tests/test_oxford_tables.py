import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from dictionary import rich_blocks


class OxfordTableTests(unittest.TestCase):
    def test_table_structure_and_safe_cell_attributes(self):
        html='<table onclick="bad()"><tr><th colspan="2">Heading</th></tr><tr><td rowspan="2">first</td><td colspan="99999">second</td></tr></table><script>bad()</script><span id="after">after😀</span>'
        blocks,_,info=rich_blocks(html,with_info=True,word='sample')
        def walk(nodes):
            for node in nodes:
                if node['type']!='text':
                    yield node
                    yield from walk(node['children'])
        nodes=list(walk([node for block in blocks for node in block]))
        self.assertEqual(info['tableCount'],1)
        self.assertEqual(next(node for node in nodes if node['name']=='th')['attrs']['colspan'],'2')
        cells=[node for node in nodes if node['name']=='td']
        self.assertEqual(cells[0]['attrs']['rowspan'],'2')
        self.assertNotIn('colspan',cells[1]['attrs'])
        table=next(node for node in nodes if node['name']=='table')
        self.assertIn('table-layout:fixed',table['attrs']['style'])
        self.assertNotIn('onclick',table['attrs'])

    def test_long_tables_split_at_rows_and_preserve_column_counts(self):
        rows=['<tr><td>'+('word%d '%index)*220+'</td>'+('<td>sound%d</td>'%index if index%3 else '')+'</tr>' for index in range(18)]
        blocks,_,info=rich_blocks('<table>'+''.join(rows)+'</table>',with_info=True,word='sample')
        def walk(nodes):
            for node in nodes:
                if node['type']!='text':
                    yield node
                    yield from walk(node['children'])
        nodes=list(walk([node for block in blocks for node in block]))
        self.assertEqual(info['tableCount'],1)
        self.assertGreater(sum(node['name']=='table' for node in nodes),1)
        rendered_rows=[node for node in nodes if node['name']=='tr']
        self.assertEqual(len(rendered_rows),18)
        self.assertTrue(all(sum(child.get('name') in {'td','th'} for child in row['children'])==2 for row in rendered_rows))


if __name__=='__main__':unittest.main()
