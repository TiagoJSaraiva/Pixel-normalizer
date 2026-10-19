# Pixel Normalizer

Uma ferramenta de linha de comando em TypeScript que estima a grade lógica de pixel art gerada por IA e substitui cada célula por uma cor representativa. Ela preserva as dimensões da imagem original e cria três variantes visuais para cada grade selecionada.

[Read this guide in English](README.md).

## Requisitos

- [Bun](https://bun.sh/)
- Sharp, instalado junto com as dependências do projeto

Instale as dependências na pasta do projeto:

```sh
bun install
```

## Início rápido

Coloque uma imagem em `input/` e informe o caminho relativo a essa pasta:

```sh
bun run pixel-normalizer.ts "minha-imagem.png"
```

Para processar todas as imagens compatíveis diretamente em `input/`, omita o nome. Os arquivos são processados na ordem retornada pela leitura da pasta; subpastas são ignoradas. As extensões aceitas são `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.tif`, `.tiff`, `.ico`, `.webp`, `.avif`, `.heic` e `.heif`, sem diferenciar maiúsculas de minúsculas.

```sh
bun run pixel-normalizer.ts --cell 8
```

Cada imagem recebe sua própria pasta de saída, na mesma ordem: `normalized-output`, `normalized-output-2` e assim por diante. Opções como `--cell`, `--grids` e `--preview` valem para todas as imagens do lote. Se não houver imagens compatíveis diretamente em `input/`, o comando informa um erro.

Subpastas são aceitas desde que a imagem permaneça dentro de `input/`:

```sh
bun run pixel-normalizer.ts "personagens/heroi.png"
```

A imagem precisa ter pelo menos 16 por 16 pixels.

## Saída

Os resultados são gravados em `output/`. Por padrão, a pasta usada é `output/normalized-output`. Use `--out` para escolher outro caminho relativo dentro de `output/`:

```sh
bun run pixel-normalizer.ts "minha-imagem.png" --out "forja"
```

Se a pasta de saída escolhida já existir, o programa cria uma pasta numerada para não substituí-la. Ele usa o próximo número após o maior sufixo numérico existente; por exemplo, se existir `output/forja-5/`, a próxima execução usará `output/forja-6/`.

No modo em lote, a mesma regra é aplicada uma vez por imagem, mantendo a ordem da listagem de `input/`. Com `--out "forja"`, as pastas serão `forja`, `forja-2` e assim por diante quando esses nomes estiverem disponíveis. `--overwrite` não é aceito no modo em lote.

Para limpar e recriar exatamente a pasta de saída escolhida, use `--overwrite` ou `-o`:

```sh
bun run pixel-normalizer.ts "minha-imagem.png" --out "forja" --overwrite
bun run pixel-normalizer.ts "minha-imagem.png" --out "forja" -o
```

`--overwrite` remove o conteúdo da pasta de saída indicada antes de gravar os novos resultados.

Cada pasta de saída contém:

- `comparativo.png`: a imagem original e as variantes geradas, organizadas para comparação visual.
- `grade-<número>-<tamanho>px-dominante.png`: cada célula recebe a cor média do agrupamento de cores mais frequente.
- `grade-<número>-<tamanho>px-mediana.png`: cada célula recebe a mediana por canal de cor.
- `grade-<número>-<tamanho>px-centro.png`: cada célula recebe a cor do pixel central.
- `report.json`: dimensões da entrada, tamanhos das grades, deslocamentos, pontuações heurísticas e caminhos das variantes geradas.

Por exemplo, um arquivo pode se chamar `grade-1-8px-dominante.png`. No modo automático, o padrão são duas grades selecionadas, com seis variantes ao todo. Use `--grids` para pedir de uma a cinco grades. No modo manual com `--cell`, o programa gera uma grade e suas três variantes.

## Opções do comando

```text
bun run pixel-normalizer.ts [<imagem>] [opções]
```

O argumento da imagem é opcional. Sem ele, o comando processa os arquivos de imagem compatíveis diretamente em `input/`.

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `--out <pasta>` | `normalized-output` | Caminho de saída relativo a `output/`. |
| `-o`, `--overwrite` | desativado | Limpa e recria a pasta de saída indicada para uma imagem; indisponível no modo em lote. |
| `--min-cell <n>` | `3` | Menor tamanho de célula lógica considerado na detecção automática. |
| `--max-cell <n>` | `128` | Maior tamanho de célula lógica considerado na detecção automática. |
| `--cell <n>` | automático | Define o tamanho da célula manualmente; o programa ainda estima os deslocamentos horizontal e vertical. |
| `--grids <n>` | `2` | Quantidade de grades alternativas no modo automático, limitada a cinco. |
| `--preview <n>` | `360` | Largura, em pixels, de cada miniatura do comparativo. A largura efetiva fica entre 100 e 600 pixels. |
| `--help`, `-h` | — | Exibe a ajuda do comando. |

Os tamanhos de célula, a quantidade de grades e a largura da prévia precisam ser inteiros positivos. `--cell` aceita um inteiro positivo seguro e pode ser maior que as dimensões da imagem. Na detecção automática, `--min-cell` deve ser menor ou igual a `--max-cell`; o limite superior também é reduzido a um quinto da menor dimensão da imagem para que haja espaço para repetição da grade.

Exemplos:

```sh
# Definir manualmente o tamanho da célula
bun run pixel-normalizer.ts "minha-imagem.png" --cell 8

# Processar todas as imagens compatíveis diretamente em input/
bun run pixel-normalizer.ts --cell 8

# Ampliar a faixa automática e gerar três grades
bun run pixel-normalizer.ts "minha-imagem.png" --min-cell 2 --max-cell 160 --grids 3

# Criar miniaturas mais largas
bun run pixel-normalizer.ts "minha-imagem.png" --preview 480

# Exibir todas as opções do CLI
bun run pixel-normalizer.ts --help
```

## Como funciona

1. O programa mede as mudanças de cor e transparência entre pixels vizinhos para criar perfis de bordas horizontais e verticais.
2. No modo automático, pontua os tamanhos candidatos e os deslocamentos da grade usando esses perfis; em seguida, seleciona tamanhos de grade distintos com pontuações altas.
3. Para cada célula, calcula uma cor representativa com um destes métodos: agrupamento dominante, mediana por canal ou pixel central.
4. Preenche cada célula com essa cor, sem interpolação. Células parciais nas bordas da imagem são mantidas, e a saída conserva as dimensões originais.

A detecção e as pontuações são heurísticas. Imagens sem uma grade global consistente, ou com tamanhos de pixel lógico diferentes entre regiões, podem não ter um único resultado que represente todos os detalhes. Compare as alternativas em `comparativo.png`.

## Tecnologia

- TypeScript executado com Bun
- Sharp para decodificar imagens e gerar PNGs
- Não requer Python, OpenCV nem serviço externo de IA
