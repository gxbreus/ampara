import { useState } from "react";
import { Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Perfil } from "../../api";
import { useSessao } from "../../sessao";
import { Botao, Campo, Erro, estilos, Protegido, Tela } from "../../ui";
export default function MeuPerfil() {
  const sessao = useSessao();
  const cache = useQueryClient();
  const perfil = useQuery({
    queryKey: ["perfil"],
    enabled: !!sessao.token,
    queryFn: () => api<Perfil>("/mobile/v1/eu/perfil-adocao"),
  });
  const [alteracoes, setForm] = useState<Perfil>({});
  const form: Perfil = {
    tipoMoradia: "CASA",
    temQuintal: false,
    outrosAnimais: false,
    horasForaDeCasa: 0,
    aceiteTermo: false,
    ...perfil.data,
    ...alteracoes,
  };
  const salvar = useMutation({
    mutationFn: () => {
      const {
        tipoMoradia,
        temQuintal,
        outrosAnimais,
        horasForaDeCasa,
        aceiteTermo,
      } = form;
      return api<Perfil>("/mobile/v1/eu/perfil-adocao", {
        method: "PUT",
        body: JSON.stringify({
          tipoMoradia,
          temQuintal,
          outrosAnimais,
          horasForaDeCasa,
          aceiteTermo,
        }),
      });
    },
    onSuccess: (atualizado) => {
      cache.setQueryData(["perfil"], atualizado);
      setForm({});
    },
  });
  const faltando =
    perfil.data?.camposFaltando ??
    (perfil.data?.completo
      ? []
      : ["Preencha todos os campos e aceite o termo."]);
  return (
    <Protegido>
      <Tela titulo="Adoção com responsabilidade">
        <Erro error={perfil.error} />
        <Text style={estilos.texto}>
          {perfil.data?.completo
            ? "Seu perfil está completo ✓"
            : `Falta completar: ${faltando.join(", ")}`}
        </Text>
        <Text style={estilos.texto}>Sua moradia</Text>
        <View style={estilos.fila}>
          {["CASA", "APARTAMENTO", "SITIO"].map((tipo) => (
            <Botao
              key={tipo}
              onPress={() => setForm({ ...form, tipoMoradia: tipo })}
            >{`${form.tipoMoradia === tipo ? "✓ " : ""}${tipo}`}</Botao>
          ))}
        </View>
        {(
          [
            ["temQuintal", "Tenho quintal"],
            ["outrosAnimais", "Tenho outros animais"],
            [
              "aceiteTermo",
              "Comprometo-me com a adoção responsável e os cuidados do animal",
            ],
          ] as const
        ).map(([campo, label]) => (
          <View key={campo} style={estilos.fila}>
            <Switch
              accessibilityLabel={label}
              value={!!form[campo]}
              onValueChange={(v) => setForm({ ...form, [campo]: v })}
            />
            <Text style={[estilos.texto, { flex: 1 }]}>{label}</Text>
          </View>
        ))}
        <Campo
          label="Horas fora de casa por dia (0 a 24)"
          keyboardType="number-pad"
          value={String(form.horasForaDeCasa ?? 0)}
          onChangeText={(s) => setForm({ ...form, horasForaDeCasa: Number(s) })}
        />
        <Erro error={salvar.error} />
        <Botao
          disabled={
            salvar.isPending ||
            !Number.isFinite(form.horasForaDeCasa) ||
            form.horasForaDeCasa! < 0 ||
            form.horasForaDeCasa! > 24
          }
          onPress={() => salvar.mutate()}
        >
          {salvar.isPending ? "Salvando…" : "Salvar perfil"}
        </Botao>
        {salvar.isSuccess && <Text style={estilos.texto}>Perfil salvo.</Text>}
        <Botao
          onPress={() => {
            void sessao.sair();
          }}
        >
          Sair da conta
        </Botao>
      </Tela>
    </Protegido>
  );
}
