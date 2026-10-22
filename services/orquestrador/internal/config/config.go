// Package config lê a configuração do serviço só de variáveis de ambiente.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Porta        string
	DatabaseURL  string
	AMQPURL      string
	TimeoutPasso time.Duration
	PrazoDecisao time.Duration
	MaxReenvios  int
}

func Carregar() (Config, error) {
	c := Config{
		Porta:       valorOuPadrao("ORQUESTRADOR_PORTA", "8081"),
		DatabaseURL: os.Getenv("ORQUESTRADOR_DATABASE_URL"),
		AMQPURL:     os.Getenv("ORQUESTRADOR_AMQP_URL"),
	}
	if c.DatabaseURL == "" {
		return c, errors.New("ORQUESTRADOR_DATABASE_URL não definida")
	}
	if c.AMQPURL == "" {
		return c, errors.New("ORQUESTRADOR_AMQP_URL não definida")
	}
	var err error
	if c.TimeoutPasso, err = duracao("ORQUESTRADOR_TIMEOUT_PASSO", "10s"); err != nil {
		return c, err
	}
	if c.PrazoDecisao, err = duracao("ORQUESTRADOR_PRAZO_EXPIRACAO", "72h"); err != nil {
		return c, err
	}
	if c.MaxReenvios, err = strconv.Atoi(valorOuPadrao("ORQUESTRADOR_MAX_REENVIOS_COMPENSACAO", "10")); err != nil {
		return c, fmt.Errorf("ORQUESTRADOR_MAX_REENVIOS_COMPENSACAO: %w", err)
	}
	return c, nil
}

func duracao(chave, padrao string) (time.Duration, error) {
	d, err := time.ParseDuration(valorOuPadrao(chave, padrao))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", chave, err)
	}
	return d, nil
}

func valorOuPadrao(chave, padrao string) string {
	if v := os.Getenv(chave); v != "" {
		return v
	}
	return padrao
}
