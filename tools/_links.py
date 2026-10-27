import sys, pymupdf
for p in sys.argv[1:]:
    d = pymupdf.open(p)
    print('==', p, 'pages', d.page_count, 'rect', d[0].rect)
    for i, page in enumerate(d):
        links = page.get_links()
        print('  page', i+1, 'links', len(links))
        for l in links[:8]:
            print('   ', l.get('kind'), l.get('uri'), l.get('from'))
    print('  toc', d.get_toc()[:6])
    print('  meta', {k: v for k, v in d.metadata.items() if v})
