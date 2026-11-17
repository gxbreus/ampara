import { useState } from "react";
import { FlatList, Image, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, type Card } from "../../api";
import { useSessao } from "../../sessao";
import { Botao, Campo, Carregando, Erro, estilos } from "../../ui";

const cidades: Record<string, [number, number]> = {
  lavras: [-21.2468, -44.9998],
  "belo horizonte": [-19.9167, -43.9345],
  "sao paulo": [-23.5505, -46.6333],
  "rio de janeiro": [-22.9068, -43.1729],
};
export default function Buscar() {
  const { token, pronto } = useSessao();
  const [cidade, setCidade] = useState("Lavras");
  const [coords, setCoords] = useState<[number, number]>(cidades.lavras);
  const [lat, setLat] = useState("-21.2468"),
    [lng, setLng] = useState("-44.9998");
  const [raio, setRaio] = useState(10),
    [especie, setEspecie] = useState(""),
    [porte, setPorte] = useState("");
  const [aviso, setAviso] = useState("");
  const busca = useInfiniteQuery({
    queryKey: ["animais", token, coords, raio, especie, porte],
    enabled: pronto,
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        lat: String(coords[0]),
        lng: String(coords[1]),
        raioKm: String(raio),
      });
      if (especie) qs.set("especie", especie);
      if (porte) qs.set("porte", porte);
      if (pageParam) qs.set("cursor", pageParam);
      return api<{ itens: Card[]; proximoCursor?: string | null }>(
        `/mobile/v1/animais?${qs}`,
      );
    },
    getNextPageParam: (pagina) => pagina.proximoCursor || undefined,
  });
  async function localizar() {
    try {
      if (
        (await Location.requestForegroundPermissionsAsync()).status !==
        "granted"
      ) {
        setAviso(
          "Localização negada. Escolha uma cidade ou informe as coordenadas de referência.",
        );
        return;
      }
      const ponto = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords([ponto.coords.latitude, ponto.coords.longitude]);
      setAviso("Busca usando sua localização atual.");
    } catch {
      setAviso("Não foi possível obter sua localização. Use a cidade abaixo.");
    }
  }
  const itens = [
    ...new Map(
      (busca.data?.pages.flatMap((p) => p.itens) ?? []).map((a) => [a.id, a]),
    ).values(),
  ];
  return (
    <FlatList
      style={estilos.tela}
      contentContainerStyle={estilos.conteudo}
      data={itens}
      keyExtractor={(a) => a.id}
      onEndReached={() => {
        if (busca.hasNextPage && !busca.isFetchingNextPage)
          void busca.fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={estilos.titulo}>Um novo encontro</Text>
          <Text style={estilos.texto}>
            Seu próximo companheiro pode estar perto.
          </Text>
          <Botao
            onPress={() => {
              void localizar();
            }}
          >
            Usar minha localização
          </Botao>
          <Text style={estilos.texto}>{aviso}</Text>
          <Campo
            label="Cidade de referência"
            value={cidade}
            onChangeText={setCidade}
          />
          <View style={estilos.fila}>
            <View style={{ flex: 1 }}>
              <Campo
                label="Latitude"
                value={lat}
                onChangeText={setLat}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Campo
                label="Longitude"
                value={lng}
                onChangeText={setLng}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
          <Botao
            onPress={() => {
              const nome = cidade
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .trim()
                .toLowerCase();
              const conhecida = cidades[nome];
              if (conhecida) {
                setCoords(conhecida);
                setAviso(`Busca na região de ${cidade}.`);
              } else if (
                Number.isFinite(Number(lat)) &&
                Number.isFinite(Number(lng)) &&
                Math.abs(Number(lat)) <= 90 &&
                Math.abs(Number(lng)) <= 180
              ) {
                setCoords([Number(lat), Number(lng)]);
                setAviso(
                  "Cidade sem referência local. Busca pelas coordenadas informadas.",
                );
              } else setAviso("Informe coordenadas válidas para esta cidade.");
            }}
          >
            Buscar nesta região
          </Botao>
          <Text style={estilos.texto}>Raio</Text>
          <View style={estilos.fila}>
            {[5, 10, 25].map((r) => (
              <Botao
                key={r}
                onPress={() => setRaio(r)}
              >{`${r === raio ? "✓ " : ""}${r} km`}</Botao>
            ))}
          </View>
          <View style={estilos.fila}>
            {[
              ["", "Todos"],
              ["CAO", "Cães"],
              ["GATO", "Gatos"],
              ["OUTRO", "Outros"],
            ].map(([v, n]) => (
              <Botao
                key={v}
                onPress={() => setEspecie(v)}
              >{`${v === especie ? "✓ " : ""}${n}`}</Botao>
            ))}
          </View>
          <View style={estilos.fila}>
            {[
              ["", "Todo porte"],
              ["PEQUENO", "Pequeno"],
              ["MEDIO", "Médio"],
              ["GRANDE", "Grande"],
            ].map(([v, n]) => (
              <Botao
                key={v}
                onPress={() => setPorte(v)}
              >{`${v === porte ? "✓ " : ""}${n}`}</Botao>
            ))}
          </View>
          <Erro error={busca.error} />
          {busca.isLoading && <Carregando />}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/animal/${item.id}`)}
          style={estilos.card}
        >
          {item.fotoThumb && (
            <Image
              source={{ uri: item.fotoThumb }}
              style={estilos.imagem}
              accessibilityLabel={item.nome}
            />
          )}
          <Text style={estilos.titulo}>{item.nome}</Text>
          <Text style={estilos.texto}>
            {item.porte} · {item.distanciaKm.toFixed(1)} km · {item.cidade}
          </Text>
          <Text style={estilos.texto}>
            {item.minhaSolicitacao
              ? "Você já tem uma solicitação"
              : "Conheça este animal"}
          </Text>
          <Text>
            Atualizado em {new Date(item.atualizadoEm).toLocaleString("pt-BR")}
          </Text>
        </Pressable>
      )}
      ListEmptyComponent={
        !busca.isLoading && !busca.isError ? (
          <Text style={estilos.texto}>
            Nenhum animal encontrado. Experimente ampliar o raio.
          </Text>
        ) : undefined
      }
      ListFooterComponent={
        busca.isFetchingNextPage ? (
          <Carregando />
        ) : (
          <Botao
            onPress={() => {
              void busca.refetch();
            }}
          >
            Atualizar busca
          </Botao>
        )
      }
    />
  );
}
