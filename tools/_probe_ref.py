import io, sys
p = r'E:\work\reverse\reverse-typora-export\evidence\real-export-html-MATH.html'
s = io.open(p, encoding='utf-8').read()

i = s.index(u'\u884c\u5185\u516c\u5f0f')   # 行内公式
print('INLINE MATH CONTEXT:')
print(repr(s[i-60:i+260]))
print()
j = s.index('mathjax-n27')
print('BLOCK MATH START:')
print(repr(s[j-260:j+120]))
print()
k = s.index('<hr />')
print('HR + IMAGE CONTEXT:')
print(repr(s[k-260:k+60]))
