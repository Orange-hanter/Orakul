import ast
ast.parse(open('/Users/dakh/Git/_my/Mozarella/Orakul/etl/quickresto/src/sync_dish_categories.py').read())
print('Syntax OK')
print('Functions:', [n.name for n in ast.parse(open('/Users/dakh/Git/_my/Mozarella/Orakul/etl/quickresto/src/sync_dish_categories.py').read()).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))])
